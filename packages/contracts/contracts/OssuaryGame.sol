// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Relics} from "./Relics.sol";

/// @notice Runs, graves and best times for Ossuary.
/// Players call through ERC-4337 smart accounts with sponsored gas, so all
/// player state is keyed by msg.sender (the smart account), never tx.origin.
/// Deaths and finishes must carry an EIP-712 signature from the verifier,
/// which replays the run's input log before signing.
contract OssuaryGame is Ownable, EIP712 {
    struct Run {
        address player;
        uint32 day;
        uint64 startedAt;
        bool open;
    }

    struct Grave {
        address player;
        uint32 day;
        uint16 tile;
        uint8 relicId;
        bool looted;
        bytes32 epitaph;
    }

    bytes32 private constant DEATH_TYPEHASH =
        keccak256("Death(uint256 runId,address player,uint16 tile,bytes32 epitaph,uint8 relicId)");
    bytes32 private constant FINISH_TYPEHASH =
        keccak256("Finish(uint256 runId,address player,uint32 timeMs,uint16 kills,bytes32 replayHash)");

    Relics public immutable relics;
    address public verifier;
    uint64 public startCooldown = 10;

    uint256 public nextRunId = 1;
    mapping(uint256 => Run) public runs;
    mapping(address => uint256) public openRunOf;
    mapping(address => uint64) public lastStartAt;

    Grave[] private _graves;
    mapping(uint32 => uint256[]) private _gravesByDay;

    /// day => player => best time in ms (0 = none yet)
    mapping(uint32 => mapping(address => uint32)) public bestTimeMs;

    event RunStarted(uint256 indexed runId, address indexed player, uint32 indexed day);
    event RunAbandoned(uint256 indexed runId, address indexed player);
    event GraveDug(
        uint256 indexed graveId, address indexed player, uint32 indexed day, uint16 tile, uint8 relicId, bytes32 epitaph
    );
    event GraveLooted(uint256 indexed graveId, address indexed looter, uint8 relicId);
    event RunFinished(
        uint256 indexed runId, address indexed player, uint32 indexed day, uint32 timeMs, uint16 kills, uint8 relicMinted
    );
    event VerifierSet(address verifier);

    error WrongDay(uint32 day, uint32 today);
    error Cooldown(uint64 readyAt);
    error NotYourRun();
    error RunClosed();
    error BadSignature();
    error NoSuchGrave();
    error AlreadyLooted();
    error OwnGrave();
    error NoRunToday();
    error NotCarrying(uint8 relicId);

    constructor(Relics relics_, address verifier_) Ownable(msg.sender) EIP712("Ossuary", "1") {
        relics = relics_;
        verifier = verifier_;
        emit VerifierSet(verifier_);
    }

    // ---- admin ----

    function setVerifier(address verifier_) external onlyOwner {
        verifier = verifier_;
        emit VerifierSet(verifier_);
    }

    function setStartCooldown(uint64 seconds_) external onlyOwner {
        startCooldown = seconds_;
    }

    // ---- views ----

    function today() public view returns (uint32) {
        return uint32(block.timestamp / 1 days);
    }

    function graveCount(uint32 day) external view returns (uint256) {
        return _gravesByDay[day].length;
    }

    function grave(uint256 graveId) external view returns (Grave memory) {
        if (graveId >= _graves.length) revert NoSuchGrave();
        return _graves[graveId];
    }

    /// @notice Paged read of one day's graves.
    function gravesOf(uint32 day, uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory ids, Grave[] memory out)
    {
        uint256[] storage all = _gravesByDay[day];
        if (offset >= all.length) return (new uint256[](0), new Grave[](0));
        uint256 end = offset + limit;
        if (end > all.length) end = all.length;
        ids = new uint256[](end - offset);
        out = new Grave[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            ids[i - offset] = all[i];
            out[i - offset] = _graves[all[i]];
        }
    }

    // ---- player actions ----

    /// @notice Opens a run for today. Any run the caller left open is abandoned.
    function startRun(uint32 day) external returns (uint256 runId) {
        uint32 t = today();
        if (day != t) revert WrongDay(day, t);
        uint64 readyAt = lastStartAt[msg.sender] + startCooldown;
        if (lastStartAt[msg.sender] != 0 && block.timestamp < readyAt) revert Cooldown(readyAt);

        uint256 prev = openRunOf[msg.sender];
        if (prev != 0) {
            runs[prev].open = false;
            emit RunAbandoned(prev, msg.sender);
        }

        runId = nextRunId++;
        runs[runId] = Run({player: msg.sender, day: day, startedAt: uint64(block.timestamp), open: true});
        openRunOf[msg.sender] = runId;
        lastStartAt[msg.sender] = uint64(block.timestamp);
        emit RunStarted(runId, msg.sender, day);
    }

    function recordDeath(uint256 runId, uint16 tile, bytes32 epitaph, uint8 relicId, bytes calldata sig)
        external
        returns (uint256 graveId)
    {
        Run storage run = _closeRun(runId);
        bytes32 digest =
            _hashTypedDataV4(keccak256(abi.encode(DEATH_TYPEHASH, runId, msg.sender, tile, epitaph, relicId)));
        _checkSig(digest, sig);

        if (relicId != 0) {
            if (relics.balanceOf(msg.sender, relicId) == 0) revert NotCarrying(relicId);
            relics.burn(msg.sender, relicId);
        }

        graveId = _graves.length;
        _graves.push(
            Grave({player: msg.sender, day: run.day, tile: tile, relicId: relicId, looted: false, epitaph: epitaph})
        );
        _gravesByDay[run.day].push(graveId);
        emit GraveDug(graveId, msg.sender, run.day, tile, relicId, epitaph);
    }

    function finishRun(uint256 runId, uint32 timeMs, uint16 kills, bytes32 replayHash, bytes calldata sig)
        external
        returns (uint8 relicId)
    {
        Run storage run = _closeRun(runId);
        bytes32 digest =
            _hashTypedDataV4(keccak256(abi.encode(FINISH_TYPEHASH, runId, msg.sender, timeMs, kills, replayHash)));
        _checkSig(digest, sig);

        uint32 best = bestTimeMs[run.day][msg.sender];
        if (best == 0 || timeMs < best) bestTimeMs[run.day][msg.sender] = timeMs;

        relicId = uint8(uint256(keccak256(abi.encode(runId, msg.sender, replayHash))) % relics.RELIC_TYPES()) + 1;
        relics.mint(msg.sender, relicId);
        emit RunFinished(runId, msg.sender, run.day, timeMs, kills, relicId);
    }

    /// @notice Takes the relic from someone else's grave. The caller must have
    /// an open run on the grave's day, and each grave can be looted once.
    function lootGrave(uint256 graveId) external {
        if (graveId >= _graves.length) revert NoSuchGrave();
        Grave storage g = _graves[graveId];
        if (g.looted) revert AlreadyLooted();
        if (g.player == msg.sender) revert OwnGrave();
        uint256 runId = openRunOf[msg.sender];
        if (runId == 0 || runs[runId].day != g.day) revert NoRunToday();

        g.looted = true;
        if (g.relicId != 0) relics.mint(msg.sender, g.relicId);
        emit GraveLooted(graveId, msg.sender, g.relicId);
    }

    // ---- internals ----

    function _closeRun(uint256 runId) private returns (Run storage run) {
        run = runs[runId];
        if (run.player != msg.sender) revert NotYourRun();
        if (!run.open) revert RunClosed();
        run.open = false;
        if (openRunOf[msg.sender] == runId) openRunOf[msg.sender] = 0;
    }

    function _checkSig(bytes32 digest, bytes calldata sig) private view {
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, sig);
        if (err != ECDSA.RecoverError.NoError || signer != verifier) revert BadSignature();
    }
}
