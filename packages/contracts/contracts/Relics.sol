// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Relics carried through Ossuary. Only the game contract mints and
/// burns: a relic is burned into a grave when its carrier dies and minted
/// again to whoever loots that grave.
contract Relics is ERC1155, Ownable {
    uint8 public constant RELIC_TYPES = 6;

    address public game;

    error NotGame();
    error BadRelic(uint256 id);

    event GameSet(address game);

    constructor(string memory uri_) ERC1155(uri_) Ownable(msg.sender) {}

    modifier onlyGame() {
        if (msg.sender != game) revert NotGame();
        _;
    }

    function setGame(address game_) external onlyOwner {
        game = game_;
        emit GameSet(game_);
    }

    function setURI(string calldata uri_) external onlyOwner {
        _setURI(uri_);
    }

    function mint(address to, uint256 id) external onlyGame {
        if (id == 0 || id > RELIC_TYPES) revert BadRelic(id);
        _mint(to, id, 1, "");
    }

    function burn(address from, uint256 id) external onlyGame {
        _burn(from, id, 1);
    }
}
