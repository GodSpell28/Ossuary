import type { LevelDef } from '../level';

// Day-one test map: a few rooms with different heights and light colours to
// prove the renderer and the collision code. The real level comes from Tiled.

export const provingGrounds: LevelDef = {
  name: 'Proving Grounds',
  sectors: {
    atrium: { floor: 0, ceil: 128, light: '#5a4c78', lightTop: '#b07850', floorTex: 'flagstone', ceilTex: 'plates' },
    duct: { floor: 0, ceil: 96, light: '#344866', lightTop: '#283450', floorTex: 'grate', ceilTex: 'plates' },
    hall: { floor: 0, ceil: 192, light: '#7a5a3a', lightTop: '#2c2040', floorTex: 'flagstone', ceilTex: 'plates' },
    stair: { floor: 16, ceil: 192, light: '#8a6a40', lightTop: '#2c2040', floorTex: 'grate', ceilTex: 'plates', wallTex: 'metal' },
    dais: { floor: 32, ceil: 192, light: '#a08048', lightTop: '#403050', floorTex: 'grate', ceilTex: 'plates', wallTex: 'metal' },
    pit: { floor: -24, ceil: 192, light: '#3c9a3c', lightTop: '#183018', floorTex: 'slime', ceilTex: 'plates', wallTex: 'brick' },
    crypt: { floor: 0, ceil: 160, light: '#a83020', lightTop: '#3a0810', floorTex: 'flagstone', ceilTex: 'plates' },
  },
  legend: {
    '#': { wall: 'brick' },
    M: { wall: 'metal' },
    X: { wall: 'tech' },
    a: { sector: 'atrium' },
    P: { sector: 'atrium', spawn: 0 },
    b: { sector: 'duct' },
    c: { sector: 'hall' },
    e: { sector: 'stair' },
    d: { sector: 'dais' },
    f: { sector: 'pit' },
    g: { sector: 'crypt' },
  },
  rows: [
    '#############MMMMMMMMMMMMMMM',
    '#aaaaaaaa####ccccccedddddccM',
    '#aaPaaaaa####ccccccedddddccM',
    '#aaaaaaaabbbbccccccedddddccM',
    '#aaaaaaaabbbbccccccccccccccM',
    '#aaaaaaaa####ccXccccccXccccM',
    '#aaaaaaaa####ccccccccccccccM',
    '####bb#######ccfffcccccccccM',
    '####bb#######ccfffccXccccccM',
    '####bb#######ccfffcccccccccM',
    '####bb#######ccccccccccccccM',
    '####bb#######MMMMMMMMMMMMMMM',
    '####bb######################',
    '#gggggggggg#################',
    '#gggggggggg#################',
    '#gggXXggggg#################',
    '#gggXXggggg#################',
    '#gggggggggg#################',
    '############################',
  ],
};
