import * as THREE from 'three';
import './style.css';
import { ensureAnonymousUser, loadLeaderboard, submitBestScore } from './firebase';
import type { LeaderboardEntry } from './firebase';

type RuleId = 'redJump' | 'blueSpin' | 'yellowWave' | 'hatBow' | 'centerCrouch' | 'edgeStar' | 'bellZoneSideKick' | 'lampSideStep' | 'greetingWave' | 'turnSpin';
type SpatialRuleId = 'centerCrouch' | 'edgeStar' | 'bellZoneSideKick' | 'lampSideStep';
type EncounterRuleId = 'redJump' | 'blueSpin' | 'yellowWave' | 'hatBow' | 'greetingWave';
type RuleNoteId = RuleId | 'bell';
type ActionName = 'jump' | 'wave' | 'spin' | 'bow' | 'crouch' | 'sideKick' | 'sideStep' | 'star';
type SubjectMark = '?' | '✓' | null;
type RuleNoteMark = '?' | '✓' | 'strike' | null;
type ControlsOrigin = 'start' | 'pause';
type Language = 'ko' | 'en';
type GameSpeed = 1 | 1.5 | 2;
type GameMode = 'casual' | 'ranked' | 'tutorial';
type ParticipantCount = 4 | 6 | 9 | 12;

interface LocalizedCopy { ko: string; en: string; }
interface RuleDefinition { id: RuleId; action: ActionName; label: LocalizedCopy; note: LocalizedCopy; stimulus?: 'red'|'blue'|'yellow'|'hat'; }
interface ActivePointer { x: number; y: number; startX: number; startY: number; }
interface SharedResult { mode:Exclude<GameMode,'tutorial'>; score:number; participants:number; timeMs:number; wrongGuesses:number; }
interface TutorialStage {
  participants: 4 | 6;
  rules: RuleId[];
  targetRuleId: RuleId;
  oddSubjectIndex: number;
  noiseObeyerIndices: number[];
  bellRuleId: RuleId | null;
  bellObeyerIndices: number[];
  title: LocalizedCopy;
  description: LocalizedCopy;
  goal: LocalizedCopy;
  tip: LocalizedCopy;
  result: LocalizedCopy;
}
interface Subject {
  id: number;
  name: string;
  root: THREE.Group;
  body: THREE.Group;
  upperBody: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  leftKnee: THREE.Group;
  rightKnee: THREE.Group;
  marker: THREE.Sprite;
  markSprite: THREE.Sprite;
  inspectedSprite: THREE.Sprite;
  mark: SubjectMark;
  inspected: boolean;
  hat: boolean;
  red: boolean;
  blue: boolean;
  yellow: boolean;
  bellObeys: boolean;
  obeys: Record<RuleId, boolean>;
  waypoint: THREE.Vector3;
  landmarkRoute: SpatialRuleId[];
  randomWaypointDue: boolean;
  speed: number;
  action: ActionName | null;
  actionTime: number;
  cooldowns: Record<RuleId, number>;
  lastCenterInside: boolean;
  lastEdgeInside: boolean;
  lastBellZoneInside: boolean;
  lastLampZoneInside: boolean;
 }

interface ObservationEncounter {
  ruleId: EncounterRuleId;
  first: Subject;
  second: Subject;
  tested: Subject[];
  stageFirstPoint: THREE.Vector3;
  stageSecondPoint: THREE.Vector3;
  closeFirstPoint: THREE.Vector3;
  closeSecondPoint: THREE.Vector3;
  phase: 'staging'|'closing'|'holding';
  holdTime: number;
  expiresAt: number;
}

interface VerdictCameraAnimation {
  startPosition: THREE.Vector3;
  endPosition: THREE.Vector3;
  startQuaternion: THREE.Quaternion;
  endQuaternion: THREE.Quaternion;
  startedAt: number;
  duration: number;
}

const RULES: RuleDefinition[] = [
  { id:'redJump', action:'jump', stimulus:'red', label:{ko:'빨강 점프',en:'RED JUMP'}, note:{ko:'빨간 옷을 입은 사람 가까이 가면 점프합니다.',en:'Jumps when near someone in a red shirt.'} },
  { id:'blueSpin', action:'spin', stimulus:'blue', label:{ko:'파랑 회전',en:'BLUE SPIN'}, note:{ko:'파란 옷을 입은 사람 가까이 가면 회전합니다.',en:'Spins when near someone in a blue shirt.'} },
  { id:'yellowWave', action:'wave', stimulus:'yellow', label:{ko:'노랑 인사',en:'YELLOW WAVE'}, note:{ko:'노란 옷을 입은 사람 가까이 가면 손을 흔듭니다.',en:'Waves when near someone in a yellow shirt.'} },
  { id:'hatBow', action:'bow', stimulus:'hat', label:{ko:'모자에게 인사',en:'HAT BOW'}, note:{ko:'모자를 쓴 사람 가까이 가면 허리를 숙입니다.',en:'Bows when near someone wearing a hat.'} },
  { id:'centerCrouch', action:'crouch', label:{ko:'중앙 쪼그리기',en:'CENTER CROUCH'}, note:{ko:'중앙 구역에 들어가면 쪼그려 앉습니다.',en:'Crouches when entering the center zone.'} },
  { id:'edgeStar', action:'star', label:{ko:'가장자리 별 자세',en:'EDGE STAR'}, note:{ko:'맵 가장자리에 들어가면 별 자세를 합니다.',en:'Makes a star pose when entering the map edge.'} },
  { id:'bellZoneSideKick', action:'sideKick', label:{ko:'종탑 옆차기',en:'BELL TOWER SIDE KICK'}, note:{ko:'종탑 근처에 가면 옆차기를 합니다.',en:'Side-kicks when approaching the bell tower.'} },
  { id:'lampSideStep', action:'sideStep', label:{ko:'조명 스텝',en:'LAMP SIDE-STEP'}, note:{ko:'모서리 조명 근처에 가면 좌우 스텝을 합니다.',en:'Side-steps when approaching a corner lamp.'} },
  { id:'greetingWave', action:'wave', label:{ko:'마주보기 인사',en:'GREETING WAVE'}, note:{ko:'다른 사람과 서로 마주 보면 손을 흔듭니다.',en:'Waves when facing another person.'} },
  { id:'turnSpin', action:'spin', label:{ko:'방향 전환 회전',en:'TURN SPIN'}, note:{ko:'이동 목표에 도착하면 한 바퀴 회전합니다.',en:'Spins once after reaching a waypoint.'} },
];
const PARTICIPANT_OPTIONS = [6,9,12] as const;
const RANKED_SEQUENCE = [6,9,12] as const;
const INITIAL_BELL_INTERVAL = [10.5,15] as const;
const BELL_INTERVAL = [15,21] as const;
const SPATIAL_RULE_IDS:SpatialRuleId[]=['centerCrouch','edgeStar','bellZoneSideKick','lampSideStep'];
const ENCOUNTER_RULE_IDS:EncounterRuleId[]=['redJump','blueSpin','yellowWave','hatBow','greetingWave'];
const SUBJECT_NAMES = ['영수','영호','영식','영철','광수','상철','민수','준호','태수','성훈','진우','동진','영숙','정숙','순자','영자','옥순','현숙','지영','수진','민지','혜진','은영','보람'];
const ARENA_SIZES:Record<ParticipantCount,number>={4:26,6:30,9:38,12:44};
const TUTORIAL_COMPLETED_KEY='the-odd-one-tutorial-completed-v1';
const TUTORIAL_OFFER_SEEN_KEY='the-odd-one-tutorial-offer-seen-v1';
const TUTORIAL_STAGES:TutorialStage[]=[
  {
    participants:4,rules:['centerCrouch'],targetRuleId:'centerCrouch',oddSubjectIndex:3,noiseObeyerIndices:[],bellRuleId:null,bellObeyerIndices:[],
    title:{ko:'진짜 규칙 찾기',en:'FIND THE TRUE RULE'},
    description:{ko:'하나뿐인 규칙을 반복해서 관찰하세요. 네 명 중 이 규칙을 혼자 어기는 사람을 찾으면 됩니다.',en:'Watch the only rule repeat. Find the one person out of four who breaks it.'},
    goal:{ko:'진짜 규칙만 등장합니다',en:'ONLY THE TRUE RULE APPEARS'},
    tip:{ko:'중앙에 들어간 사람들의 행동을 비교하세요.',en:'COMPARE WHAT PEOPLE DO WHEN THEY ENTER THE CENTER.'},
    result:{ko:'진짜 규칙은 모두에게 공통이지만, 한 명만 어깁니다.',en:'THE TRUE RULE IS SHARED BY EVERYONE EXCEPT ONE PERSON.'},
  },
  {
    participants:6,rules:['centerCrouch','edgeStar'],targetRuleId:'edgeStar',oddSubjectIndex:1,noiseObeyerIndices:[0,2,4],bellRuleId:null,bellObeyerIndices:[],
    title:{ko:'가짜 규칙 구별하기',en:'IGNORE THE FAKE RULE'},
    description:{ko:'이번에는 가짜 규칙이 하나 섞입니다. 여섯 명 중 다섯 명이 따르는 규칙이 진짜입니다.',en:'One fake rule is mixed in. The rule followed by five of six people is the true one.'},
    goal:{ko:'진짜 규칙 1개 + 가짜 규칙 1개',en:'1 TRUE RULE + 1 FAKE RULE'},
    tip:{ko:'일부만 따르는 규칙보다 거의 모두가 따르는 규칙을 찾으세요.',en:'LOOK FOR THE RULE ALMOST EVERYONE FOLLOWS.'},
    result:{ko:'가짜 규칙은 일부만 따릅니다. 진짜 규칙의 한 명짜리 예외를 찾으세요.',en:'ONLY SOME PEOPLE FOLLOW A FAKE RULE. FIND THE SINGLE EXCEPTION TO THE TRUE RULE.'},
  },
  {
    participants:6,rules:['lampSideStep','centerCrouch'],targetRuleId:'lampSideStep',oddSubjectIndex:4,noiseObeyerIndices:[0,2,5],bellRuleId:'centerCrouch',bellObeyerIndices:[1,3,5],
    title:{ko:'종소리에 흔들리지 않기',en:'IGNORE THE BELL DISTRACTION'},
    description:{ko:'마지막에는 종소리가 일부 참가자에게 행동을 강제합니다. 종 반응은 정답이 아닌 가짜 단서입니다.',en:'Finally, the bell forces some people to act. Bell reactions are a fake clue, never the answer.'},
    goal:{ko:'진짜 규칙 + 가짜 규칙 + 종소리',en:'TRUE RULE + FAKE RULE + BELL'},
    tip:{ko:'종이 울린 순간은 넘기고, 장소에 따른 행동을 비교하세요.',en:'IGNORE THE MOMENT THE BELL RINGS AND COMPARE LOCATION-BASED ACTIONS.'},
    result:{ko:'종소리는 일부에게 같은 행동을 강제하지만 정답 규칙은 아닙니다.',en:'THE BELL FORCES THE SAME ACTION ON SOME PEOPLE, BUT IT IS NEVER THE ANSWER.'},
  },
];
let RULE_NOTE_ORDER:RuleNoteId[]=[...RULES.slice(0,4).map(rule=>rule.id),'bell'];
const ruleNoteMarks={} as Record<RuleNoteId,RuleNoteMark>;
[...RULES.map(rule=>rule.id),'bell' as const].forEach(ruleId=>ruleNoteMarks[ruleId]=null);
const ACTION_LABELS:Record<ActionName,LocalizedCopy>={jump:{ko:'점프',en:'JUMP'},wave:{ko:'손 흔들기',en:'WAVE'},spin:{ko:'회전',en:'SPIN'},bow:{ko:'허리 숙이기',en:'BOW'},crouch:{ko:'쪼그려 앉기',en:'CROUCH'},sideKick:{ko:'옆차기',en:'SIDE KICK'},sideStep:{ko:'좌우 스텝',en:'SIDE-STEP'},star:{ko:'별 자세',en:'STAR POSE'}};
const ACTION_VERBS:Record<ActionName,LocalizedCopy>={jump:{ko:'점프합니다',en:'jump'},wave:{ko:'손을 흔듭니다',en:'wave'},spin:{ko:'회전합니다',en:'spin'},bow:{ko:'허리를 숙입니다',en:'bow'},crouch:{ko:'쪼그려 앉습니다',en:'crouch'},sideKick:{ko:'옆차기를 합니다',en:'side-kick'},sideStep:{ko:'좌우 스텝을 합니다',en:'side-step'},star:{ko:'별 자세를 합니다',en:'make a star pose'}};
const ACTION_DURATION:Record<ActionName,number>={jump:1.25,wave:1.25,spin:1.3,bow:1.25,crouch:1.45,sideKick:1.25,sideStep:1.4,star:1.25};

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const touchMode = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 || new URLSearchParams(location.search).has('touch');
document.body.classList.toggle('touch-mode', touchMode);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, touchMode ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x171713);
scene.fog = new THREE.FogExp2(0x171713, 0.018);
const camera = new THREE.PerspectiveCamera(touchMode&&innerHeight>innerWidth?72:62, innerWidth / innerHeight, 0.1, 180);
camera.position.set(0, 13, 24);
camera.rotation.order = 'YXZ';

scene.add(new THREE.HemisphereLight(0xdde6d3, 0x31291c, 1.35));
const sun = new THREE.DirectionalLight(0xffe2ae, 3.2);
sun.position.set(-16, 24, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(touchMode ? 1024 : 2048, touchMode ? 1024 : 2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -35;
sun.shadow.camera.right = sun.shadow.camera.top = 35;
scene.add(sun);

const world = new THREE.Group();
scene.add(world);
const environment = new THREE.Group();
world.add(environment);
const floorMat = new THREE.MeshStandardMaterial({ color: 0x5b5a4d, roughness: .95, metalness: 0 });
const floor = new THREE.Mesh(new THREE.PlaneGeometry(58, 58), floorMat);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
environment.add(floor);

const grid = new THREE.GridHelper(58, 29, 0x787665, 0x686657);
grid.position.y = .012;
grid.material.transparent = true;
grid.material.opacity = .32;
environment.add(grid);

const centerRing = new THREE.Mesh(
  new THREE.RingGeometry(5.6, 5.85, 64),
  new THREE.MeshBasicMaterial({ color: 0xf4b942, transparent: true, opacity: .52, side: THREE.DoubleSide }),
);
centerRing.rotation.x = -Math.PI / 2;
centerRing.position.y = .03;
environment.add(centerRing);

function box(size: [number, number, number], color: number, x: number, y: number, z: number) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({ color, roughness: .85 }));
  mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; environment.add(mesh); return mesh;
}

const lampLights:THREE.PointLight[]=[];
// Sparse landmarks make NPC paths and distances easy to read from the air.
for (const [x, z] of [[-24,-24],[24,-24],[-24,24],[24,24]] as [number,number][]) {
  box([2.5, 5.5, 2.5], 0x34342f, x, 2.75, z);
  const lamp = new THREE.PointLight(0xf4b942, 17, 12, 2); lamp.position.set(x, 5.7, z); environment.add(lamp);lampLights.push(lamp);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(.24, 10, 8), new THREE.MeshBasicMaterial({color:0xf4b942})); bulb.position.copy(lamp.position); environment.add(bulb);
}
const bellRig = new THREE.Group();
const bellPost = new THREE.Mesh(new THREE.CylinderGeometry(.18,.22,6,10), new THREE.MeshStandardMaterial({color:0x232421}));
bellPost.position.y=3; bellRig.add(bellPost);
const bell = new THREE.Mesh(new THREE.CylinderGeometry(.9,.45,1.1,16,1,true),new THREE.MeshStandardMaterial({color:0xc58d24,metalness:.65,roughness:.3,side:THREE.DoubleSide}));
bell.position.y=6.1; bellRig.add(bell); bellRig.position.set(0,0,-25); environment.add(bellRig);

const dustGeometry=new THREE.BufferGeometry();
const dustPositions=new Float32Array((touchMode?55:95)*3);
for(let index=0;index<dustPositions.length;index+=3){dustPositions[index]=THREE.MathUtils.randFloatSpread(54);dustPositions[index+1]=THREE.MathUtils.randFloat(.35,8);dustPositions[index+2]=THREE.MathUtils.randFloatSpread(54);}
dustGeometry.setAttribute('position',new THREE.BufferAttribute(dustPositions,3));
const dust=new THREE.Points(dustGeometry,new THREE.PointsMaterial({color:0xe7d8ae,size:touchMode ? .055 : .07,transparent:true,opacity:.17,depthWrite:false}));
environment.add(dust);

const shirtColors = [0xc94f43,0x325b82,0xc8a642,0x567359,0x703e68,0xd3d0bd];
const pantsColors = [0x222a35,0x4a4037,0x26362e,0x47464d];
const skinColors = [0xf0c6a1,0xc98d62,0x8e573d,0x5e382b];
const hairColors = [0x17130f,0x4a2d1a,0xd0aa65,0x6a6a62];
const HAT_SUBJECT_IDS = new Set([1,4,8,10,13,16,19,22]);
const subjects: Subject[] = [];
const pickables: THREE.Object3D[] = [];
const questionTexture = makeSymbolTexture('?', '#74b9e8');
const clearTexture = makeSymbolTexture('✓', '#52c6a5');
const inspectedTextures={ko:makeInspectedTexture('확인됨'),en:makeInspectedTexture('INSPECTED')};

function mat(color: number) { return new THREE.MeshStandardMaterial({ color, roughness: .85 }); }
function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D, y = 0) {
  const value = new THREE.Mesh(geometry, material); value.position.y = y; value.castShadow = true; value.receiveShadow = true; parent.add(value); return value;
}

function makeMarkerTexture(label:string) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 96;
  const ctx = c.getContext('2d')!; ctx.fillStyle='#f4b942'; ctx.beginPath(); ctx.roundRect(4,4,248,88,14); ctx.fill();
  ctx.fillStyle='#171713'; ctx.textAlign='center'; ctx.textBaseline='middle';
  let fontSize=46;
  do { ctx.font=`700 ${fontSize--}px "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`; } while(ctx.measureText(label).width>216&&fontSize>30);
  ctx.fillText(label,128,50);
  const texture = new THREE.CanvasTexture(c); texture.colorSpace=THREE.SRGBColorSpace; return texture;
}

function makeInspectedTexture(label:string) {
  const c=document.createElement('canvas');c.width=320;c.height=92;
  const ctx=c.getContext('2d')!;ctx.fillStyle='rgba(17,17,15,.94)';ctx.beginPath();ctx.roundRect(4,4,312,84,16);ctx.fill();
  ctx.strokeStyle='#e65b47';ctx.lineWidth=7;ctx.beginPath();ctx.arc(48,42,18,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.moveTo(61,55);ctx.lineTo(79,73);ctx.stroke();
  ctx.fillStyle='#ff8c79';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='700 32px "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';ctx.fillText(label,194,48);
  const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}

function makeSymbolTexture(symbol:string,color:string) {
  const c=document.createElement('canvas');c.width=128;c.height=128;
  const ctx=c.getContext('2d')!;ctx.fillStyle='rgba(17,17,15,.92)';ctx.beginPath();ctx.arc(64,64,58,0,Math.PI*2);ctx.fill();
  ctx.lineWidth=7;ctx.strokeStyle=color;ctx.stroke();
  if(symbol==='✓') {
    ctx.lineWidth=12;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(34,66);ctx.lineTo(54,84);ctx.lineTo(94,42);ctx.stroke();
  } else {
    ctx.fillStyle=color;ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='700 82px "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';ctx.fillText(symbol,64,66);
  }
  const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}

function makeSubject(id: number): Subject {
  const name=SUBJECT_NAMES[id];
  const root = new THREE.Group(); root.userData.subjectId = id;
  const body = new THREE.Group(); root.add(body);
  const upperBody = new THREE.Group(); upperBody.position.y=1.78;body.add(upperBody);
  const shirt = id < 3 ? 0xc94f43 : shirtColors[id % shirtColors.length];
  const hat = HAT_SUBJECT_IDS.has(id);
  const skin = skinColors[id % skinColors.length];
  const torso = mesh(new THREE.BoxGeometry(1.18,1.55,.72),mat(shirt),upperBody,.77); torso.userData.subjectId=id;
  const head = mesh(new THREE.BoxGeometry(.88,.9,.78),mat(skin),upperBody,2); head.userData.subjectId=id;
  const hair = mesh(new THREE.BoxGeometry(.92,.25,.82),mat(hairColors[id%hairColors.length]),upperBody,2.42); hair.userData.subjectId=id;
  const leftArm = new THREE.Group(); leftArm.position.set(-.76,1.3,0); upperBody.add(leftArm);
  const rightArm = new THREE.Group(); rightArm.position.set(.76,1.3,0); upperBody.add(rightArm);
  mesh(new THREE.BoxGeometry(.32,1.45,.36),mat(skin),leftArm,-.67);
  mesh(new THREE.BoxGeometry(.32,1.45,.36),mat(skin),rightArm,-.67);
  const makeLeg=(side:number)=>{
    const leg=new THREE.Group();leg.position.set(side*.34,1.75,0);body.add(leg);
    mesh(new THREE.BoxGeometry(.48,.82,.52),mat(pantsColors[id%pantsColors.length]),leg,-.38);
    const knee=new THREE.Group();knee.position.y=-.78;leg.add(knee);
    mesh(new THREE.BoxGeometry(.48,.9,.52),mat(pantsColors[id%pantsColors.length]),knee,-.43);
    return {leg,knee};
  };
  const left=makeLeg(-1),right=makeLeg(1);
  if (hat) {
    const brim=mesh(new THREE.CylinderGeometry(.65,.65,.12,12),mat(0x272722),upperBody,2.65); brim.userData.subjectId=id;
    const cap=mesh(new THREE.CylinderGeometry(.44,.52,.42,12),mat(id%2?0xd3ac3b:0x454c3f),upperBody,2.89); cap.userData.subjectId=id;
  }
  const marker = new THREE.Sprite(new THREE.SpriteMaterial({map:makeMarkerTexture(name),transparent:true,depthTest:false,opacity:0}));
  marker.scale.set(3.2,1.2,1); marker.position.y=6.45; root.add(marker);
  const markSprite=new THREE.Sprite(new THREE.SpriteMaterial({map:questionTexture,transparent:true,depthTest:false,opacity:0}));
  markSprite.scale.set(1.45,1.45,1);markSprite.position.y=5.25;root.add(markSprite);
  const inspectedSprite=new THREE.Sprite(new THREE.SpriteMaterial({map:inspectedTextures.ko,transparent:true,depthTest:false,opacity:0}));
  inspectedSprite.scale.set(3.5,1,1);inspectedSprite.position.y=7.55;root.add(inspectedSprite);
  root.position.set((id%4-1.5)*6.5,0,(Math.floor(id/4)-1)*8);
  root.traverse(child=>{ if((child as THREE.Mesh).isMesh){ child.userData.subjectId=id; pickables.push(child); }});
  world.add(root);
  const cooldowns=Object.fromEntries(RULES.map(rule=>[rule.id,0])) as Record<RuleId,number>;
  return { id,name,root,body,upperBody,leftArm,rightArm,leftLeg:left.leg,rightLeg:right.leg,leftKnee:left.knee,rightKnee:right.knee,marker,markSprite,inspectedSprite,mark:null,inspected:false,hat,red:shirt===0xc94f43,blue:shirt===0x325b82,yellow:shirt===0xc8a642,bellObeys:false,obeys:{} as Record<RuleId,boolean>,waypoint:new THREE.Vector3(),landmarkRoute:[],randomWaypointDue:false,speed:1.7+Math.random()*.6,action:null,actionTime:0,cooldowns,lastCenterInside:false,lastEdgeInside:false,lastBellZoneInside:false,lastLampZoneInside:false };
}
for(let i=0;i<24;i++) subjects.push(makeSubject(i));

let activeRules=RULES.slice(0,4);
let activeRuleIds=new Set<RuleId>(activeRules.map(rule=>rule.id));
let targetRule = activeRules[0];
let bellSourceRule=activeRules[0];
let bellAction:ActionName=bellSourceRule.action;
let participantCount:ParticipantCount=6;
let activeSubjects:Subject[]=[];
let activeSubjectIds=new Set<number>();
let oddId = 0;
let attemptLimit = 2;
let attempts = attemptLimit;
let playing = false;
let paused = false;
let soundVolume=readSoundVolume();
let lastAudibleVolume=soundVolume>0?soundVolume:.65;
let soundEnabled=soundVolume>0;
let audioContext:AudioContext|null=null;
let masterGain:GainNode|null=null;
let ambientGain:GainNode|null=null;
let ambientStarted=false;
let pointerLockAcquired = false;
let pointerLockRequestId = 0;
let pointerLockReleaseTimers: number[] = [];
let altCursorMode = false;
let language:Language=readLanguage();
let roundResult:'success'|'fail'|null=null;
let arenaSize=ARENA_SIZES[participantCount];
let arenaHalf=arenaSize/2;
let arenaScale=arenaSize/58;
let centerTriggerRadius=5.6*arenaScale;
let suppressAccusationUntil = 0;
let controlsOrigin: ControlsOrigin = 'start';
let controlsAcknowledged = readControlsAcknowledged();
let rulesDismissed = readRulesDismissed();
let roundElapsedTime = 0;
let simulationTime = 0;
let roundStartedAt = 0;
let casualPausedMs = 0;
let casualPauseStartedAt = 0;
let bellTimer:number = INITIAL_BELL_INTERVAL[0];
let bellEnabled=true;
let observationEncounter:ObservationEncounter|null=null;
let nextObservationOpportunityAt=0;
let observationRuleCursor=0;
let observationSubjectCursor=0;
let observationAnchorCursor=0;
let gameSpeed:GameSpeed = 1;
let yaw = 0;
let pitch = -.28;
let hovered: Subject | null = null;
let selectedSubject: Subject | null = null;
let followedSubject: Subject | null = null;
const keys = new Set<string>();
const raycaster = new THREE.Raycaster();
const activePointers = new Map<number,ActivePointer>();
const mobileTarget = new THREE.Vector3(0,1.8,0);
const mobileSpherical = new THREE.Spherical(35,1.06,0);
const desktopFollowSpherical = new THREE.Spherical(18,1.05,0);
const desktopFreePosition = new THREE.Vector3();
let desktopFreeYaw = 0;
let desktopFreePitch = -.28;
let desktopCameraHeight = 8;
let previousGestureCenter = new THREE.Vector2();
let previousGestureDistance = 0;
let mobileDragged = false;
let lastTouchEndTime = 0;
let lastTouchEndX = Number.NEGATIVE_INFINITY;
let lastTouchEndY = Number.NEGATIVE_INFINITY;
let lastTouchEndTarget:EventTarget|null = null;
const mobileSelection = document.querySelector<HTMLElement>('#mobile-selection')!;
const mobileSubjectLabel = document.querySelector<HTMLElement>('#mobile-subject')!;
const questionButton = document.querySelector<HTMLButtonElement>('#mark-question')!;
const clearButton = document.querySelector<HTMLButtonElement>('#mark-clear')!;
const followButton = document.querySelector<HTMLButtonElement>('#mobile-follow')!;
const controlsScreen = document.querySelector<HTMLElement>('#controls-screen')!;
const controlsCloseButton = document.querySelector<HTMLButtonElement>('#controls-close-button')!;
const rulesScreen = document.querySelector<HTMLElement>('#rules-screen')!;
const rulesContinueButton = document.querySelector<HTMLButtonElement>('#rules-continue-button')!;
const dontShowRules = document.querySelector<HTMLInputElement>('#dont-show-rules')!;
const rulesMajorityExample = document.querySelector<HTMLElement>('#rules-majority-example')!;
const participantButtons=[...document.querySelectorAll<HTMLButtonElement>('[data-participant-count]')];
const subjectCountSummary=document.querySelector<HTMLElement>('#subject-count-summary')!;
const ruleCountSummary=document.querySelector<HTMLElement>('#rule-count-summary')!;
const attemptCountSummary=document.querySelector<HTMLElement>('#attempt-count-summary')!;
const rulesChances=document.querySelector<HTMLElement>('#rules-chances')!;
const ruleCountBadge=document.querySelector<HTMLElement>('#rule-count-badge')!;
const ruleNotes=document.querySelector<HTMLElement>('#rule-notes')!;
const ruleNotesToggle=document.querySelector<HTMLButtonElement>('#rule-notes-toggle')!;
const ruleNoteRows=[...document.querySelectorAll<HTMLButtonElement>('[data-rule-note]')];
const mobileBellStatus=document.querySelector<HTMLElement>('#mobile-bell-status')!;
const languageToggle=document.querySelector<HTMLButtonElement>('#language-toggle')!;
const mobilePauseButton=document.querySelector<HTMLButtonElement>('#mobile-pause')!;
const speedControls=document.querySelector<HTMLElement>('#speed-controls')!;
const speedButtons=[...document.querySelectorAll<HTMLButtonElement>('[data-game-speed]')];
const volumeSliders=[...document.querySelectorAll<HTMLInputElement>('.volume-slider')];
const volumeOutputs=[...document.querySelectorAll<HTMLOutputElement>('.volume-control output')];
const gameModeButtons=[...document.querySelectorAll<HTMLButtonElement>('[data-game-mode]')];
const participantSelector=document.querySelector<HTMLElement>('.participant-selector')!;
const rankSequenceSummary=document.querySelector<HTMLElement>('#rank-sequence-summary')!;
const rankIntroScreen=document.querySelector<HTMLElement>('#rank-intro-screen')!;
const tutorialOfferScreen=document.querySelector<HTMLElement>('#tutorial-offer-screen')!;
const tutorialOfferStartButton=document.querySelector<HTMLButtonElement>('#tutorial-offer-start')!;
const tutorialOfferSkipButton=document.querySelector<HTMLButtonElement>('#tutorial-offer-skip')!;
const tutorialButton=document.querySelector<HTMLButtonElement>('#tutorial-button')!;
const tutorialIntroScreen=document.querySelector<HTMLElement>('#tutorial-intro-screen')!;
const tutorialStartButton=document.querySelector<HTMLButtonElement>('#tutorial-start-button')!;
const tutorialStageLabel=document.querySelector<HTMLElement>('#tutorial-stage-label')!;
const tutorialStageTitle=document.querySelector<HTMLElement>('#tutorial-stage-title')!;
const tutorialStageDescription=document.querySelector<HTMLElement>('#tutorial-stage-description')!;
const tutorialStageGoal=document.querySelector<HTMLElement>('#tutorial-stage-goal')!;
const tutorialStageTip=document.querySelector<HTMLElement>('#tutorial-stage-tip')!;
const tutorialProgress=[...document.querySelectorAll<HTMLElement>('#tutorial-progress li')];
const tutorialHud=document.querySelector<HTMLElement>('#tutorial-hud')!;
const tutorialHudStage=document.querySelector<HTMLElement>('#tutorial-hud-stage')!;
const tutorialHudHint=document.querySelector<HTMLElement>('#tutorial-hud-hint')!;
const tutorialResultStatus=document.querySelector<HTMLElement>('#tutorial-result-status')!;
const rankNameInput=document.querySelector<HTMLInputElement>('#rank-name-input')!;
const rankNameError=document.querySelector<HTMLElement>('#rank-name-error')!;
const rankStartButton=document.querySelector<HTMLButtonElement>('#rank-start-button')!;
const rankSubmitPanel=document.querySelector<HTMLElement>('#rank-submit-panel')!;
const rankSubmitButton=document.querySelector<HTMLButtonElement>('#rank-submit-button')!;
const leaderboardScreen=document.querySelector<HTMLElement>('#leaderboard-screen')!;
const leaderboardList=document.querySelector<HTMLElement>('#leaderboard-list')!;
const rankedResultStatus=document.querySelector<HTMLElement>('#ranked-result-status')!;
const scoreSummary=document.querySelector<HTMLElement>('#score-summary')!;
const roundScoreLabel=document.querySelector<HTMLElement>('#round-score')!;
const totalScoreLabel=document.querySelector<HTMLElement>('#total-score')!;
const shareResultButton=document.querySelector<HTMLButtonElement>('#share-result-button')!;
const shareScreen=document.querySelector<HTMLElement>('#share-screen')!;
const shareDialog=document.querySelector<HTMLElement>('.share-dialog')!;
const shareModeLabel=document.querySelector<HTMLElement>('#share-mode')!;
const shareScoreLabel=document.querySelector<HTMLElement>('#share-score')!;
const shareTimeLabel=document.querySelector<HTMLElement>('#share-time')!;
const shareWrongLabel=document.querySelector<HTMLElement>('#share-wrong')!;
const shareFeedback=document.querySelector<HTMLElement>('#share-feedback')!;
let gameMode:GameMode='casual';
let tutorialStageIndex=0;
let tutorialCompleted=readTutorialCompleted();
let tutorialOfferSeen=readTutorialOfferSeen();
let tutorialOfferMode:Exclude<GameMode,'tutorial'>='casual';
let authBusy=false;
let roundStarting=false;
let leaderboardEntries:LeaderboardEntry[]=[];
let leaderboardLoading=false;
let leaderboardFailed=false;
let rankedSaveState:'saving'|'saved'|'unchanged'|'error'|null=null;
let rankedRunState:'idle'|'active'|'completed'|'failed'='idle';
let rankedStageIndex=0;
let rankedTotalScore=0;
let rankedTotalTimeMs=0;
let rankedWrongGuesses=0;
let latestRoundScore=0;
let rankedNickname=readRankedNickname();
let activeShareResult:SharedResult|null=null;
let completedRoundShareResult:SharedResult|null=null;
let rankedSaveRequestId=0;
let resolvingAccusation=false;
let verdictCamera:VerdictCameraAnimation|null=null;
let verdictSequenceId=0;
let bellVisualTime=0;
const roundTransition=document.querySelector<HTMLElement>('#round-transition')!;
const verdictFeedback=document.querySelector<HTMLElement>('#verdict-feedback')!;
const verdictLabel=document.querySelector<HTMLElement>('#verdict-label')!;

function copy(ko:string,en:string){return language==='ko'?ko:en;}

function readTutorialCompleted() {
  try { return localStorage.getItem(TUTORIAL_COMPLETED_KEY)==='yes'; }
  catch { return false; }
}

function rememberTutorialCompleted() {
  tutorialCompleted=true;
  try { localStorage.setItem(TUTORIAL_COMPLETED_KEY,'yes'); }
  catch { /* Completion remains available for this session. */ }
  updateTutorialUI();
}

function readTutorialOfferSeen() {
  try { return localStorage.getItem(TUTORIAL_OFFER_SEEN_KEY)==='yes'; }
  catch { return false; }
}

function rememberTutorialOfferSeen() {
  tutorialOfferSeen=true;
  try { localStorage.setItem(TUTORIAL_OFFER_SEEN_KEY,'yes'); }
  catch { /* The recommendation may appear again in a later session. */ }
}

function readLanguage():Language {
  try { return localStorage.getItem('the-odd-one-language')==='en'?'en':'ko'; }
  catch { return 'ko'; }
}

function readSoundVolume() {
  try {
    const raw=localStorage.getItem('the-odd-one-volume');
    if(raw===null)return .65;
    const stored=Number(raw);
    return Number.isFinite(stored)&&stored>=0&&stored<=1?stored:.65;
  } catch { return .65; }
}

function applyLanguage() {
  document.documentElement.lang=language;
  document.querySelectorAll<HTMLElement>('[data-ko][data-en]').forEach(element=>{element.textContent=element.dataset[language]??'';});
  document.querySelectorAll<HTMLInputElement>('[data-placeholder-ko][data-placeholder-en]').forEach(element=>{element.placeholder=element.dataset[`placeholder${language==='ko'?'Ko':'En'}`]??'';});
  languageToggle.textContent=language==='ko'?'KR':'EN';
  languageToggle.setAttribute('aria-label',language==='ko'?'Switch to English':'한국어로 전환');
  mobilePauseButton.setAttribute('aria-label',copy('게임 일시정지','Pause game'));
  speedControls.setAttribute('aria-label',copy('게임 속도','Game speed'));
  subjects.forEach(subject=>{subject.inspectedSprite.material.map=inspectedTextures[language];subject.inspectedSprite.material.needsUpdate=true;});
  setParticipantCount(participantCount);updateSoundButtons();updateAttempts();updateFollowButton();
  renderRuleNotes();
  RULE_NOTE_ORDER.forEach(updateRuleNote);
  if(controlsScreen.classList.contains('open'))updateControlsCloseButton();
  if(roundResult)updateResultCopy();
  if(activeShareResult)renderShareResult(activeShareResult);
  updateGameModeUI();
  updateTutorialUI();
  updateTutorialOfferUI();
  if(leaderboardScreen.classList.contains('open'))renderLeaderboard();
}

function readRankedNickname() {
  try { return (localStorage.getItem('the-odd-one-ranked-name')||'').slice(0,10); }
  catch { return ''; }
}

function setGameMode(mode:GameMode) {
  gameMode=mode;
  updateGameModeUI();
}

function updateGameModeUI() {
  gameModeButtons.forEach(button=>{
    const selected=button.dataset.gameMode===gameMode;
    button.classList.toggle('active',selected);
    button.setAttribute('aria-checked',String(selected));
    button.disabled=authBusy||roundStarting;
  });
  const ranked=gameMode==='ranked';
  const tutorial=gameMode==='tutorial';
  participantSelector.hidden=ranked;
  rankSequenceSummary.hidden=!ranked;
  document.body.classList.toggle('rank-mode',ranked);
  document.body.classList.toggle('tutorial-mode',tutorial);
  const playButton=document.querySelector<HTMLButtonElement>('#play-button')!;
  playButton.disabled=roundStarting||authBusy;
  const playLabel=playButton.querySelector('span')!;
  if(roundStarting||authBusy)playLabel.textContent=copy('랭크 준비 중','PREPARING RANKED RUN');
  else playLabel.textContent=ranked?copy('랭크 도전','START RANKED RUN'):copy('게임 시작','START GAME');
}

function updateTutorialUI() {
  const stage=TUTORIAL_STAGES[tutorialStageIndex];
  tutorialButton.querySelector('span')!.textContent=tutorialCompleted?copy('튜토리얼 다시하기','REPLAY TUTORIAL'):copy('처음이신가요? 튜토리얼','NEW HERE? PLAY THE TUTORIAL');
  tutorialStageLabel.textContent=copy(`튜토리얼 ${tutorialStageIndex+1} / ${TUTORIAL_STAGES.length}`,`TUTORIAL ${tutorialStageIndex+1} / ${TUTORIAL_STAGES.length}`);
  tutorialStageTitle.textContent=stage.title[language];
  tutorialStageDescription.textContent=stage.description[language];
  tutorialStageGoal.textContent=stage.goal[language];
  tutorialStageTip.textContent=stage.tip[language];
  tutorialHudStage.textContent=copy(`튜토리얼 ${tutorialStageIndex+1}/${TUTORIAL_STAGES.length}`,`TUTORIAL ${tutorialStageIndex+1}/${TUTORIAL_STAGES.length}`);
  tutorialHudHint.textContent=stage.tip[language];
  tutorialProgress.forEach((item,index)=>{
    item.classList.toggle('active',index===tutorialStageIndex);
    item.classList.toggle('done',index<tutorialStageIndex);
  });
}

function updateTutorialOfferUI() {
  tutorialOfferSkipButton.textContent=tutorialOfferMode==='ranked'?copy('랭크 도전 계속','CONTINUE TO RANKED'):copy('일반 게임 계속','CONTINUE TO CASUAL');
}

function shouldOfferTutorial() {
  const existingPlayer=controlsAcknowledged||rulesDismissed;
  return !tutorialCompleted&&!tutorialOfferSeen&&!existingPlayer;
}

function openTutorialOffer() {
  tutorialOfferMode=gameMode==='ranked'?'ranked':'casual';
  updateTutorialOfferUI();
  tutorialOfferScreen.classList.add('open');tutorialOfferScreen.setAttribute('aria-hidden','false');
  setTimeout(()=>tutorialOfferStartButton.focus(),0);
}

function closeTutorialOffer() {
  tutorialOfferScreen.classList.remove('open');tutorialOfferScreen.setAttribute('aria-hidden','true');
  document.querySelector<HTMLButtonElement>('#play-button')!.focus();
}

function continueSelectedModeStart(mode:Exclude<GameMode,'tutorial'>=gameMode==='ranked'?'ranked':'casual') {
  if(mode==='ranked')openRankIntro();
  else requestStartRound();
}

function requestSelectedModeStart() {
  if(shouldOfferTutorial()){openTutorialOffer();return;}
  continueSelectedModeStart();
}

function acceptTutorialOffer() {
  closeTutorialOffer();beginTutorial();
}

function skipTutorialOffer() {
  const mode=tutorialOfferMode;
  rememberTutorialOfferSeen();closeTutorialOffer();continueSelectedModeStart(mode);
}

function openTutorialIntro() {
  setGameMode('tutorial');
  setParticipantCount(TUTORIAL_STAGES[tutorialStageIndex].participants);
  setGameSpeed(1);
  updateTutorialUI();
  document.querySelector('#start-screen')!.classList.remove('open');
  document.querySelector('#end-screen')!.classList.remove('open');
  tutorialIntroScreen.classList.add('open');tutorialIntroScreen.setAttribute('aria-hidden','false');
  setTimeout(()=>tutorialStartButton.focus(),0);
}

function closeTutorialIntroToHome() {
  returnToStartScreen();
  tutorialButton.focus();
}

function beginTutorial() {
  rememberTutorialOfferSeen();
  tutorialStageIndex=0;
  openTutorialIntro();
}

function startTutorialStage() {
  tutorialIntroScreen.classList.remove('open');tutorialIntroScreen.setAttribute('aria-hidden','true');
  continueStartFlow();
}

function renderLeaderboard() {
  leaderboardList.replaceChildren();
  if(leaderboardLoading) {
    const message=document.createElement('div');message.className='leaderboard-message';message.textContent=copy('랭킹을 불러오는 중입니다…','LOADING LEADERBOARD…');leaderboardList.append(message);return;
  }
  if(leaderboardFailed) {
    const message=document.createElement('div');message.className='leaderboard-message';message.textContent=copy('랭킹을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.','COULD NOT LOAD THE LEADERBOARD. TRY AGAIN SOON.');leaderboardList.append(message);return;
  }
  if(!leaderboardEntries.length) {
    const message=document.createElement('div');message.className='leaderboard-message';message.textContent=copy('아직 기록이 없습니다. 첫 클리어를 남겨보세요.','NO RECORDS YET. CLAIM THE FIRST CLEAR.');leaderboardList.append(message);return;
  }
  let displayedRank=0;
  leaderboardEntries.forEach((entry,index)=>{
    if(index===0||entry.score!==leaderboardEntries[index-1].score)displayedRank=index+1;
    const row=document.createElement('div');row.className='leaderboard-row';
    const player=document.createElement('div');player.className='leaderboard-player';
    const rank=document.createElement('span');rank.className='leaderboard-rank';rank.textContent=copy(`${displayedRank}위`,`#${displayedRank}`);
    const name=document.createElement('span');name.className='leaderboard-name';name.textContent=entry.displayName;
    const score=document.createElement('div');score.className='leaderboard-score';
    const points=document.createElement('b');points.textContent=entry.score.toLocaleString();
    player.append(rank,name);score.append(points);row.append(player,score);leaderboardList.append(row);
  });
}

async function refreshLeaderboard() {
  leaderboardLoading=true;leaderboardFailed=false;renderLeaderboard();
  try { leaderboardEntries=await loadLeaderboard(); }
  catch(error) { console.warn('Leaderboard could not be loaded.',error);leaderboardEntries=[];leaderboardFailed=true; }
  finally { leaderboardLoading=false;renderLeaderboard(); }
}

function openLeaderboard() {
  leaderboardScreen.classList.add('open');leaderboardScreen.setAttribute('aria-hidden','false');
  void refreshLeaderboard();
}

function closeLeaderboard() {
  leaderboardScreen.classList.remove('open');leaderboardScreen.setAttribute('aria-hidden','true');
  document.querySelector<HTMLButtonElement>('#leaderboard-button')!.focus();
}

function selectGameMode(mode:GameMode) {
  setGameMode(mode);
}

function openRankIntro() {
  rankIntroScreen.classList.add('open');rankIntroScreen.setAttribute('aria-hidden','false');
  setTimeout(()=>rankStartButton.focus(),0);
}

function closeRankIntro() {
  rankIntroScreen.classList.remove('open');rankIntroScreen.setAttribute('aria-hidden','true');
  document.querySelector<HTMLButtonElement>('#play-button')!.focus();
}

function beginRankedRun() {
  rankedRunState='active';rankedStageIndex=0;rankedTotalScore=0;rankedTotalTimeMs=0;rankedWrongGuesses=0;latestRoundScore=0;rankedSaveState=null;
  setParticipantCount(RANKED_SEQUENCE[0]);closeRankIntro();requestStartRound();
}

function setGameSpeed(speed:GameSpeed) {
  gameSpeed=speed;
  speedButtons.forEach(button=>{
    const selected=Number(button.dataset.gameSpeed)===speed;
    button.classList.toggle('active',selected);
    button.setAttribute('aria-pressed',String(selected));
  });
}

function toggleLanguage(){
  language=language==='ko'?'en':'ko';
  try { localStorage.setItem('the-odd-one-language',language); } catch { /* Keep the current session language. */ }
  applyLanguage();
}

function readControlsAcknowledged() {
  try { return localStorage.getItem('the-odd-one-controls-v3')==='seen'; }
  catch { return false; }
}

function readRulesDismissed() {
  try { return localStorage.getItem('the-odd-one-rules-v4')==='hidden'; }
  catch { return false; }
}

function rememberRulesDismissed() {
  if(!dontShowRules.checked)return;
  rulesDismissed=true;
  try { localStorage.setItem('the-odd-one-rules-v4','hidden'); }
  catch { /* The rules screen will simply appear again next time. */ }
}

function rememberControlsAcknowledged() {
  controlsAcknowledged=true;
  try { localStorage.setItem('the-odd-one-controls-v3','seen'); }
  catch { /* The guide still works when storage is unavailable. */ }
}

function openControls(origin:ControlsOrigin) {
  controlsOrigin=origin;
  updateControlsCloseButton();
  controlsScreen.classList.add('open');
  controlsScreen.setAttribute('aria-hidden','false');
  controlsCloseButton.focus();
}

function updateControlsCloseButton() {
  controlsCloseButton.innerHTML=controlsOrigin==='start'?`${copy('관찰 시작','START OBSERVATION')} <b>→</b>`:`${copy('일시정지로 돌아가기','BACK TO PAUSE')} <b>←</b>`;
}

function closeControls() {
  controlsScreen.classList.remove('open');
  controlsScreen.setAttribute('aria-hidden','true');
  if(controlsOrigin==='start'){rememberControlsAcknowledged();startRound();}
}

function requestStartRound() {
  if(!rulesDismissed) {
    dontShowRules.checked=false;
    rulesScreen.classList.add('open');
    rulesScreen.setAttribute('aria-hidden','false');
    rulesContinueButton.focus();
  } else continueStartFlow();
}

function continueStartFlow() {
  if(controlsAcknowledged)startRound();
  else openControls('start');
}

function closeRules() {
  rememberRulesDismissed();
  rulesScreen.classList.remove('open');
  rulesScreen.setAttribute('aria-hidden','true');
  continueStartFlow();
}

function subjectFocus(subject:Subject) {
  return subject.root.position.clone().add(new THREE.Vector3(0,2.3,0));
}

function initializeMobileCamera() {
  setFollowSubject(null,false);
  mobileTarget.set(0,1.8,0);
  mobileSpherical.set(THREE.MathUtils.clamp(arenaSize*(innerHeight>innerWidth?.67:.6),18,42),1.06,0);
  applyMobileCamera();
}

function applyMobileCamera() {
  const target=followedSubject?subjectFocus(followedSubject):mobileTarget;
  camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(mobileSpherical));
  camera.lookAt(target);
}

function selectSubject(subject:Subject|null) {
  selectedSubject=subject;
  hovered=subject;
  document.body.classList.toggle('selection-active',!!subject);
  mobileSelection.classList.toggle('open',!!subject);
  if(subject) {
    mobileSubjectLabel.textContent=subject.name;
  }
  updateMarkButtons();
  updateFollowButton();
}

function updateMarkButtons() {
  questionButton.classList.toggle('active',selectedSubject?.mark==='?');
  clearButton.classList.toggle('active',selectedSubject?.mark==='✓');
  questionButton.setAttribute('aria-pressed',String(selectedSubject?.mark==='?'));
  clearButton.setAttribute('aria-pressed',String(selectedSubject?.mark==='✓'));
}

function updateFollowButton() {
  const active=!!selectedSubject&&followedSubject===selectedSubject;
  followButton.classList.toggle('active',active);
  followButton.setAttribute('aria-pressed',String(active));
  followButton.querySelector('small')!.textContent=active?copy('해제','RELEASE'):copy('따라가기','FOLLOW');
}

function applyDesktopFollowCamera() {
  if(!followedSubject)return;
  const target=subjectFocus(followedSubject);
  camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(desktopFollowSpherical));
  camera.lookAt(target);
}

function setFollowSubject(subject:Subject|null,notify=true) {
  if(subject===followedSubject)return;
  const wasFollowing=followedSubject!==null;
  followedSubject=subject;
  if(subject) {
    const target=subjectFocus(subject);
    if(touchMode)applyMobileCamera();
    else {
      if(!wasFollowing) {
        desktopFreePosition.copy(camera.position);
        desktopFreeYaw=yaw;
        desktopFreePitch=pitch;
      }
      desktopFollowSpherical.setFromVector3(camera.position.clone().sub(target));
      desktopFollowSpherical.radius=THREE.MathUtils.clamp(desktopFollowSpherical.radius,6,45);
      desktopFollowSpherical.phi=THREE.MathUtils.clamp(desktopFollowSpherical.phi,.35,1.4);
      applyDesktopFollowCamera();
    }
    if(notify)showToast(copy(`${subject.name} 따라가는 중`,`FOLLOWING ${subject.name}`),false,1100);
  } else {
    if(touchMode)applyMobileCamera();
    else if(wasFollowing) {
      camera.position.copy(desktopFreePosition);
      yaw=desktopFreeYaw;pitch=desktopFreePitch;
      camera.rotation.order='YXZ';camera.rotation.set(pitch,yaw,0);
    }
    if(notify)showToast(copy('따라가기 해제','FOLLOW RELEASED'),false,900);
  }
  updateFollowButton();
}

function toggleFollow(subject:Subject|null) {
  if(!subject&&followedSubject)setFollowSubject(null);
  else if(subject)setFollowSubject(followedSubject===subject?null:subject);
}

function adjustDesktopZoom(direction:number) {
  if(touchMode||!playing||paused)return;
  camera.fov=THREE.MathUtils.clamp(camera.fov+direction*4,32,75);
  camera.updateProjectionMatrix();
}

function setSubjectMark(subject:Subject,mark:SubjectMark) {
  subject.mark=mark;
  if(mark)subject.markSprite.material.map=mark==='?'?questionTexture:clearTexture;
  subject.markSprite.material.opacity=mark?1:0;
  subject.markSprite.material.needsUpdate=true;
  updateMarkButtons();
}

function cycleSubjectMark(subject:Subject) {
  setSubjectMark(subject,subject.mark===null?'?':subject.mark==='?'?'✓':null);playInterfaceSound('mark');
}

function setParticipantCount(count:ParticipantCount) {
  participantCount=count;
  const ruleCount=ruleCountForParticipants();
  attemptLimit=attemptLimitForParticipants(count);
  if(!playing&&roundResult===null)attempts=attemptLimit;
  subjectCountSummary.textContent=copy(`참가자 ${count}명`,`${count} NPCS`);
  ruleCountSummary.textContent=copy(`정답 후보 ${ruleCount}개`,`${ruleCount} TARGET RULES`);
  attemptCountSummary.textContent=copy(`기회 ${attemptLimit}번`,`${attemptLimit} CHANCES`);
  rulesChances.textContent=copy(`기회는 ${attemptLimit}번입니다.`,`YOU HAVE ${attemptLimit} CHANCES.`);
  ruleCountBadge.textContent=String(ruleCount);
  rulesMajorityExample.textContent=copy(
    `${count}명 중 ${count-1}명은 지키고, 한 명만 어깁니다.`,
    `${count-1} of ${count} NPCs follow it. Only one breaks it.`,
  );
  participantButtons.forEach(button=>{
    const active=Number(button.dataset.participantCount)===count;
    button.classList.toggle('active',active);button.setAttribute('aria-checked',String(active));
  });
  updateAttempts();
}

function setRuleNotesOpen(value:boolean) {
  if(playing)value=true;
  ruleNotes.classList.toggle('open',value);ruleNotes.setAttribute('aria-hidden',String(!value));
  ruleNotesToggle.classList.toggle('show',!value);ruleNotesToggle.setAttribute('aria-expanded',String(value));
}

function renderRuleNotes() {
  RULE_NOTE_ORDER=[...activeRules.map(rule=>rule.id),...(bellEnabled?['bell' as const]:[])];
  const bellNote={ko:`종이 울리면 일부 참가자가 ${ACTION_VERBS[bellAction].ko}.`,en:`When the bell rings, some NPCs ${ACTION_VERBS[bellAction].en}.`};
  mobileBellStatus.textContent=`🔔 ${bellNote[language]}`;
  mobileBellStatus.hidden=!bellEnabled;
  ruleNoteRows.forEach((row,index)=>{
    const ruleId=RULE_NOTE_ORDER[index];
    row.classList.toggle('bell-note',ruleId==='bell');
    row.hidden=!ruleId;
    if(!ruleId)return;
    row.dataset.ruleNote=ruleId;
    const indexLabel=row.querySelector<HTMLElement>('.note-index')!;indexLabel.textContent=ruleId==='bell'?'🔔':String(index+1);
    row.setAttribute('aria-disabled',String(ruleId==='bell'));row.tabIndex=ruleId==='bell'?-1:0;
    const detail=row.querySelector<HTMLElement>('.note-copy small')!;
    if(ruleId==='bell') {
      detail.dataset.ko=bellNote.ko;detail.dataset.en=bellNote.en;
    } else {
      const rule=RULES.find(candidate=>candidate.id===ruleId)!;
      detail.dataset.ko=rule.note.ko;detail.dataset.en=rule.note.en;
    }
    detail.textContent=detail.dataset[language]??'';
  });
}

function updateRuleNote(ruleId:RuleNoteId) {
  const row=ruleNoteRows.find(button=>button.dataset.ruleNote===ruleId);if(!row)return;
  if(ruleId==='bell') {
    row.classList.remove('mark-question','mark-check','mark-strike');
    row.setAttribute('aria-label',language==='ko'?'종 교란 이벤트. 체크할 수 없는 참고 정보입니다.':'Bell distraction event. Informational only.');return;
  }
  const mark=ruleNoteMarks[ruleId];row.classList.toggle('mark-question',mark==='?');row.classList.toggle('mark-check',mark==='✓');row.classList.toggle('mark-strike',mark==='strike');
  const label=row.querySelector('.note-copy small')?.textContent??ruleId;
  const state=language==='ko'?(mark==='?'?'의심':mark==='✓'?'확인':mark==='strike'?'제외':'표시 없음'):(mark==='?'?'questioned':mark==='✓'?'checked':mark==='strike'?'ruled out':'unmarked');
  row.setAttribute('aria-label',language==='ko'?`${label}: ${state}. 눌러서 표시 변경.`:`${label}: ${state}. Cycle checklist mark.`);
}

function cycleRuleNote(ruleId:RuleNoteId) {
  if(ruleId==='bell')return;
  const current=ruleNoteMarks[ruleId];ruleNoteMarks[ruleId]=current===null?'?':current==='?'?'✓':current==='✓'?'strike':null;updateRuleNote(ruleId);playInterfaceSound('mark');
}

function resetRuleNotes() {
  RULE_NOTE_ORDER.forEach(ruleId=>{ruleNoteMarks[ruleId]=null;updateRuleNote(ruleId);});setRuleNotesOpen(true);
}

function randomWaypoint(out: THREE.Vector3) {
  const limit=Math.max(8,arenaHalf-5);
  out.set(THREE.MathUtils.randFloat(-limit,limit),0,THREE.MathUtils.randFloat(-limit,limit));
  if(Math.abs(out.x)<centerTriggerRadius*1.15 && Math.abs(out.z)<centerTriggerRadius*1.15 && Math.random()<.45) out.multiplyScalar(1.5);
}

function landmarkWaypoint(ruleId:SpatialRuleId,out:THREE.Vector3) {
  if(ruleId==='centerCrouch') {
    const angle=Math.random()*Math.PI*2,radius=Math.random()*centerTriggerRadius*.45;
    out.set(Math.cos(angle)*radius,0,Math.sin(angle)*radius);return;
  }
  if(ruleId==='edgeStar') {
    const edge=arenaHalf*.74,tangent=THREE.MathUtils.randFloat(-arenaHalf*.48,arenaHalf*.48);
    const side=Math.floor(Math.random()*4);
    out.set(side<2?(side===0?-edge:edge):tangent,0,side<2?tangent:(side===2?-edge:edge));return;
  }
  if(ruleId==='bellZoneSideKick') {
    const radius=Math.max(2.8,5*arenaScale),bellZ=-25*arenaScale;
    out.set(THREE.MathUtils.randFloat(-radius*.42,radius*.42),0,bellZ+radius*THREE.MathUtils.randFloat(.32,.5));return;
  }
  const radius=Math.max(2.8,4.5*arenaScale),lamp=24*arenaScale;
  const signX=Math.random()<.5?-1:1,signZ=Math.random()<.5?-1:1;
  out.set(signX*(lamp-radius*THREE.MathUtils.randFloat(.32,.46)),0,signZ*(lamp-radius*THREE.MathUtils.randFloat(.32,.46)));
}

function chooseNextWaypoint(subject:Subject) {
  const landmarks=SPATIAL_RULE_IDS.filter(ruleId=>activeRuleIds.has(ruleId));
  if(!landmarks.length) {randomWaypoint(subject.waypoint);return;}
  if(subject.randomWaypointDue) {
    randomWaypoint(subject.waypoint);subject.randomWaypointDue=false;
    if(!subject.landmarkRoute.length)subject.landmarkRoute=shuffle(landmarks);
    return;
  }
  if(!subject.landmarkRoute.length)subject.landmarkRoute=shuffle(landmarks);
  landmarkWaypoint(subject.landmarkRoute.pop()!,subject.waypoint);
  subject.randomWaypointDue=true;
}

function activeEncounterRuleIds() {
  return activeRules.map(rule=>rule.id).filter((ruleId):ruleId is EncounterRuleId=>ENCOUNTER_RULE_IDS.includes(ruleId as EncounterRuleId));
}

function observationPointFor(subject:Subject) {
  const encounter=observationEncounter;if(!encounter)return null;
  const closing=encounter.phase!=='staging';
  if(subject===encounter.first)return closing?encounter.closeFirstPoint:encounter.stageFirstPoint;
  if(subject===encounter.second)return closing?encounter.closeSecondPoint:encounter.stageSecondPoint;
  return null;
}

function observationConflictScore(subject:Subject,scheduledRuleId:EncounterRuleId) {
  return activeRules.filter(rule=>rule.id!==scheduledRuleId&&rule.stimulus&&stimulusPoolFor(rule).includes(subject)).length;
}

function finishObservationEncounter(delay=THREE.MathUtils.randFloat(4,6)) {
  const encounter=observationEncounter;if(!encounter)return;
  observationEncounter=null;
  for(const subject of new Set([encounter.first,encounter.second]))if(activeSubjectIds.has(subject.id))chooseNextWaypoint(subject);
  nextObservationOpportunityAt=simulationTime+delay;
}

function scheduleObservationEncounter() {
  const encounterRuleIds=activeEncounterRuleIds();
  if(!encounterRuleIds.length){nextObservationOpportunityAt=Number.POSITIVE_INFINITY;return;}
  const ruleId=encounterRuleIds[observationRuleCursor%encounterRuleIds.length];
  observationRuleCursor=(observationRuleCursor+1)%encounterRuleIds.length;
  let first:Subject|null=null;
  for(let offset=0;offset<activeSubjects.length;offset++) {
    const index=(observationSubjectCursor+offset)%activeSubjects.length;
    const candidate=activeSubjects[index];
    if(!candidate.action&&candidate.cooldowns[ruleId]<=0) {
      first=candidate;observationSubjectCursor=(index+1)%activeSubjects.length;break;
    }
  }
  if(!first){nextObservationOpportunityAt=simulationTime+2;return;}
  let second:Subject|undefined;
  let tested:Subject[]=[first];
  if(ruleId==='greetingWave') {
    second=shuffle(activeSubjects.filter(subject=>subject!==first&&!subject.action&&subject.cooldowns[ruleId]<=0))[0];
    if(second)tested=[first,second];
  } else {
    const rule=RULES.find(candidate=>candidate.id===ruleId)!;
    const candidates=shuffle(activeSubjects.filter(subject=>subject!==first&&stimulusPoolFor(rule).includes(subject)&&!subject.action));
    candidates.sort((a,b)=>observationConflictScore(a,ruleId)-observationConflictScore(b,ruleId));
    second=candidates[0]??shuffle(activeSubjects.filter(subject=>subject!==first&&stimulusPoolFor(rule).includes(subject)))[0];
  }
  if(!second){nextObservationOpportunityAt=simulationTime+2;return;}
  const angle=observationAnchorCursor++*2.3999632297+Math.random()*.25;
  const radius=Math.min(arenaHalf*.42,centerTriggerRadius+3.2);
  const anchor=new THREE.Vector3(Math.cos(angle)*radius,0,Math.sin(angle)*radius);
  const axis=new THREE.Vector3(-Math.sin(angle),0,Math.cos(angle));
  const stageDistance=3.2,closeDistance=.72;
  const stageFirstPoint=anchor.clone().addScaledVector(axis,stageDistance);
  const stageSecondPoint=anchor.clone().addScaledVector(axis,-stageDistance);
  const closeFirstPoint=anchor.clone().addScaledVector(axis,closeDistance);
  const closeSecondPoint=anchor.clone().addScaledVector(axis,-closeDistance);
  observationEncounter={ruleId,first,second,tested,stageFirstPoint,stageSecondPoint,closeFirstPoint,closeSecondPoint,phase:'staging',holdTime:0,expiresAt:simulationTime+18};
  first.waypoint.copy(stageFirstPoint);second.waypoint.copy(stageSecondPoint);
}

function faceObservationPair(encounter:ObservationEncounter) {
  const toSecond=encounter.second.root.position.clone().sub(encounter.first.root.position);
  encounter.first.root.rotation.y=Math.atan2(toSecond.x,toSecond.z);
  encounter.second.root.rotation.y=Math.atan2(-toSecond.x,-toSecond.z);
}

function updateObservationScheduler(dt:number) {
  if(!observationEncounter) {
    if(simulationTime>=nextObservationOpportunityAt)scheduleObservationEncounter();
    return;
  }
  const encounter=observationEncounter;
  if(simulationTime>=encounter.expiresAt){finishObservationEncounter(THREE.MathUtils.randFloat(3,5));return;}
  const firstPoint=observationPointFor(encounter.first)!;
  const secondPoint=observationPointFor(encounter.second)!;
  encounter.first.waypoint.copy(firstPoint);encounter.second.waypoint.copy(secondPoint);
  const firstArrived=encounter.first.root.position.distanceToSquared(firstPoint)<.16;
  const secondArrived=encounter.second.root.position.distanceToSquared(secondPoint)<.16;
  if(encounter.phase==='staging'&&firstArrived&&secondArrived) {
    encounter.first.root.position.copy(firstPoint);encounter.second.root.position.copy(secondPoint);
    if(encounter.tested.every(subject=>!subject.action&&subject.cooldowns[encounter.ruleId]<=0)) {
      encounter.phase='closing';
      encounter.first.waypoint.copy(encounter.closeFirstPoint);encounter.second.waypoint.copy(encounter.closeSecondPoint);
    }
    return;
  }
  if(encounter.phase==='closing'&&firstArrived&&secondArrived) {
    encounter.first.root.position.copy(firstPoint);encounter.second.root.position.copy(secondPoint);
    encounter.phase='holding';encounter.holdTime=0;faceObservationPair(encounter);return;
  }
  if(encounter.phase==='holding') {
    encounter.first.root.position.copy(encounter.closeFirstPoint);encounter.second.root.position.copy(encounter.closeSecondPoint);
    faceObservationPair(encounter);encounter.holdTime+=dt;
    if(encounter.holdTime>=1.35)finishObservationEncounter();
  }
}

function resetObservationScheduler() {
  observationEncounter=null;observationRuleCursor=0;observationSubjectCursor=Math.floor(Math.random()*Math.max(1,activeSubjects.length));observationAnchorCursor=Math.random()*8;
  nextObservationOpportunityAt=simulationTime+THREE.MathUtils.randFloat(4,6);
}

function configureArena() {
  arenaSize=ARENA_SIZES[participantCount];arenaHalf=arenaSize/2;arenaScale=arenaSize/58;centerTriggerRadius=5.6*arenaScale;
  environment.scale.set(arenaScale,1,arenaScale);
}

function stimulusPoolFor(rule:RuleDefinition) {
  if(rule.stimulus==='red')return subjects.filter(subject=>subject.red);
  if(rule.stimulus==='blue')return subjects.filter(subject=>subject.blue);
  if(rule.stimulus==='yellow')return subjects.filter(subject=>subject.yellow);
  if(rule.stimulus==='hat')return subjects.filter(subject=>subject.hat);
  return [];
}

function requireSubjects(required:Subject[],predicate:(subject:Subject)=>boolean,desired:number,count:number,label:string) {
  while(required.filter(predicate).length<desired) {
    const candidate=shuffle(subjects.filter(subject=>predicate(subject)&&!required.includes(subject)))[0];
    if(!candidate||required.length>=count)throw new Error(`Could not satisfy participant appearance requirement: ${label}.`);
    required.push(candidate);
  }
}

function chooseParticipants(count:number,rules:RuleDefinition[],target:RuleDefinition) {
  const required:Subject[]=[];
  if(rules.some(rule=>rule.id==='hatBow')) {
    for(const colorRule of rules.filter(rule=>rule.stimulus&&rule.stimulus!=='hat')) {
      const colorPool=new Set(stimulusPoolFor(colorRule));
      requireSubjects(required,subject=>colorPool.has(subject)&&!subject.hat,1,count,`${colorRule.id}: color without hat`);
      requireSubjects(required,subject=>!colorPool.has(subject)&&subject.hat,1,count,`${colorRule.id}: non-color with hat`);
    }
  }
  for(const rule of [target,...shuffle(rules.filter(candidate=>candidate!==target))]) {
    const stimulusPool=stimulusPoolFor(rule);
    if(stimulusPool.length)requireSubjects(required,subject=>stimulusPool.includes(subject),2,count,`${rule.id}: two stimulus NPCs`);
  }
  const remaining=shuffle(subjects.filter(subject=>!required.includes(subject))).slice(0,count-required.length);
  return shuffle([...required,...remaining]);
}

function ruleCountForParticipants() {
  if(gameMode==='tutorial')return TUTORIAL_STAGES[tutorialStageIndex].rules.length;
  return participantCount===6?2:participantCount===9?3:4;
}

function attemptLimitForParticipants(count:ParticipantCount=participantCount) {
  return 2;
}

function chooseActiveRules() {
  const rulesByAction=new Map<ActionName,RuleDefinition[]>();
  for(const rule of RULES)rulesByAction.set(rule.action,[...(rulesByAction.get(rule.action)??[]),rule]);
  return shuffle([...rulesByAction.values()]).slice(0,ruleCountForParticipants()).map(group=>shuffle(group)[0]);
}

function halfCount(count:number) {
  return count%2===0?count/2:(Math.random()<.5?Math.floor(count/2):Math.ceil(count/2));
}

function assignBalancedNoise(rule:RuleDefinition|null) {
  const selected=new Set(shuffle(activeSubjects).slice(0,halfCount(participantCount)).map(subject=>subject.id));
  activeSubjects.forEach(subject=>{
    if(rule)subject.obeys[rule.id]=selected.has(subject.id);
    else subject.bellObeys=selected.has(subject.id);
  });
}

function configureTutorialRules() {
  const stage=TUTORIAL_STAGES[tutorialStageIndex];
  activeRules=stage.rules.map(ruleId=>RULES.find(rule=>rule.id===ruleId)!);
  activeRuleIds=new Set(activeRules.map(rule=>rule.id));
  targetRule=RULES.find(rule=>rule.id===stage.targetRuleId)!;
  bellEnabled=stage.bellRuleId!==null;
  bellSourceRule=RULES.find(rule=>rule.id===(stage.bellRuleId??stage.targetRuleId))!;
  bellAction=bellSourceRule.action;
  activeSubjects=subjects.slice(0,stage.participants);
  activeSubjectIds=new Set(activeSubjects.map(subject=>subject.id));
  oddId=activeSubjects[stage.oddSubjectIndex].id;
  subjects.forEach(subject=>{subject.root.visible=activeSubjectIds.has(subject.id);subject.bellObeys=false;for(const rule of RULES)subject.obeys[rule.id]=false;});
  activeSubjects.forEach(subject=>subject.obeys[targetRule.id]=subject.id!==oddId);
  const noiseRule=activeRules.find(rule=>rule.id!==targetRule.id);
  if(noiseRule)stage.noiseObeyerIndices.forEach(index=>activeSubjects[index].obeys[noiseRule.id]=true);
  stage.bellObeyerIndices.forEach(index=>activeSubjects[index].bellObeys=true);
}

function configureRound() {
  configureArena();
  if(gameMode==='tutorial')configureTutorialRules();
  else {
    bellEnabled=true;
    activeRules=chooseActiveRules();activeRuleIds=new Set(activeRules.map(rule=>rule.id));
    targetRule=activeRules[Math.floor(Math.random()*activeRules.length)];
    bellSourceRule=activeRules[Math.floor(Math.random()*activeRules.length)];bellAction=bellSourceRule.action;
    activeSubjects=chooseParticipants(participantCount,activeRules,targetRule);activeSubjectIds=new Set(activeSubjects.map(subject=>subject.id));
    oddId=activeSubjects[Math.floor(Math.random()*activeSubjects.length)].id;
    subjects.forEach(subject=>{subject.root.visible=activeSubjectIds.has(subject.id);subject.bellObeys=false;for(const rule of RULES)subject.obeys[rule.id]=false;});
    activeSubjects.forEach(subject=>subject.obeys[targetRule.id]=subject.id!==oddId);
    activeRules.filter(rule=>rule.id!==targetRule.id).forEach(rule=>assignBalancedNoise(rule));
    assignBalancedNoise(null);
  }
  const columns=participantCount<=9?3:participantCount<=12?4:6;const rows=Math.ceil(participantCount/columns);
  subjects.forEach(s=>{
    s.landmarkRoute=[];s.randomWaypointDue=Math.random()<.35;chooseNextWaypoint(s);s.action=null;s.actionTime=0;resetActionPose(s);s.marker.material.opacity=0;s.marker.material.color.set(0xffffff);s.inspected=false;s.inspectedSprite.material.opacity=0;setSubjectMark(s,null);
    Object.keys(s.cooldowns).forEach(k=>s.cooldowns[k as RuleId]=0);s.lastCenterInside=false;s.lastEdgeInside=false;s.lastBellZoneInside=false;s.lastLampZoneInside=false;
  });
  activeSubjects.forEach((subject,index)=>subject.root.position.set((index%columns-(columns-1)/2)*6.5,0,(Math.floor(index/columns)-(rows-1)/2)*7));
  validateRoundConfiguration();
  attemptLimit=attemptLimitForParticipants();attempts=attemptLimit;roundElapsedTime=0;simulationTime=0;resetObservationScheduler();proximityTimer=0;roundStartedAt=performance.now();casualPausedMs=0;casualPauseStartedAt=0;bellTimer=THREE.MathUtils.randFloat(INITIAL_BELL_INTERVAL[0],INITIAL_BELL_INTERVAL[1]);renderRuleNotes();updateAttempts();resetRuleNotes();
}

function validateRoundConfiguration() {
  const expectedRuleCount=ruleCountForParticipants();
  if(activeSubjects.length!==participantCount||new Set(activeSubjects.map(subject=>subject.id)).size!==participantCount)throw new Error('A round must contain the selected number of unique participants.');
  if(activeRules.length!==expectedRuleCount||new Set(activeRules.map(rule=>rule.id)).size!==expectedRuleCount)throw new Error(`A ${participantCount}-NPC round must select ${expectedRuleCount} distinct behavior rules.`);
  if(new Set(activeRules.map(rule=>rule.action)).size!==expectedRuleCount)throw new Error('Active behavior rules must use distinct actions.');
  if(!activeRuleIds.has(targetRule.id))throw new Error('Target rule must be active.');
  if(bellEnabled&&(!activeRuleIds.has(bellSourceRule.id)||bellAction!==bellSourceRule.action))throw new Error('Bell behavior must match one active rule action.');
  for(const rule of activeRules) {
    const obeyCount=activeSubjects.filter(subject=>subject.obeys[rule.id]).length;
    if(rule.id===targetRule.id&&obeyCount!==participantCount-1)throw new Error('Target rule must be N-1:1.');
    if(rule.id!==targetRule.id&&Math.abs(obeyCount-participantCount/2)>.5)throw new Error('Noise rules must split subjects as evenly as possible.');
    const requiredStimuli=rule.stimulus?2:0;
    if(requiredStimuli&&activeSubjects.filter(subject=>stimulusPoolFor(rule).includes(subject)).length<requiredStimuli)throw new Error('Active appearance rules require visible stimulus NPCs.');
  }
  if(activeRuleIds.has('hatBow')) {
    for(const colorRule of activeRules.filter(rule=>rule.stimulus&&rule.stimulus!=='hat')) {
      const colorPool=new Set(stimulusPoolFor(colorRule));
      if(!activeSubjects.some(subject=>colorPool.has(subject)&&!subject.hat))throw new Error(`${colorRule.id} requires a color-without-hat cross-sample.`);
      if(!activeSubjects.some(subject=>!colorPool.has(subject)&&subject.hat))throw new Error(`${colorRule.id} requires a non-color-with-hat cross-sample.`);
    }
  }
  const bellObeyCount=activeSubjects.filter(subject=>subject.bellObeys).length;
  if(bellEnabled&&Math.abs(bellObeyCount-participantCount/2)>.5)throw new Error('Bell noise must split subjects as evenly as possible.');
  if(!bellEnabled&&bellObeyCount!==0)throw new Error('A bell-free tutorial stage cannot assign bell responders.');
}

function shuffle<T>(items:T[]) {
  const shuffled=[...items];
  for(let index=shuffled.length-1;index>0;index--) {
    const swapIndex=Math.floor(Math.random()*(index+1));
    [shuffled[index],shuffled[swapIndex]]=[shuffled[swapIndex],shuffled[index]];
  }
  return shuffled;
}

function trigger(subject:Subject, ruleId:RuleId) {
  if(!activeRuleIds.has(ruleId))return true;
  if(subject.cooldowns[ruleId]>0)return true;
  if(subject.action)return !subject.obeys[ruleId];
  subject.cooldowns[ruleId]=ruleId==='greetingWave'?5:['centerCrouch','edgeStar','bellZoneSideKick','lampSideStep','turnSpin'].includes(ruleId)?6:3.5;
  if(subject.obeys[ruleId]) { subject.action=RULES.find(r=>r.id===ruleId)!.action; subject.actionTime=0; }
  return true;
}

function ringBell() {
  if(!bellEnabled)return;
  bellTimer=gameMode==='tutorial'?18:THREE.MathUtils.randFloat(BELL_INTERVAL[0],BELL_INTERVAL[1]);
  if(observationEncounter&&[observationEncounter.first,observationEncounter.second].some(subject=>subject.bellObeys))finishObservationEncounter(THREE.MathUtils.randFloat(5.25,7.75));
  activeSubjects.forEach(subject=>{
    if(!subject.bellObeys)return;
    resetActionPose(subject);
    subject.action=bellAction;subject.actionTime=0;
  });
  bellVisualTime=1.2;bell.scale.set(1.3,.8,1.3);playBellSound();showToast(copy(`종 이벤트 · ${ACTION_LABELS[bellAction].ko}`,`BELL EVENT · ${ACTION_LABELS[bellAction].en}`),false,900);
}

function ensureAudioContext() {
  if(!soundEnabled)return null;
  if(audioContext)return audioContext;
  const AudioCtx=window.AudioContext || (window as typeof window & {webkitAudioContext:typeof AudioContext}).webkitAudioContext;
  audioContext=new AudioCtx();masterGain=audioContext.createGain();masterGain.gain.value=soundVolume;masterGain.connect(audioContext.destination);
  return audioContext;
}

function syncAudioMix() {
  if(!audioContext||!masterGain)return;
  const now=audioContext.currentTime;masterGain.gain.cancelScheduledValues(now);masterGain.gain.setTargetAtTime(soundEnabled?soundVolume:0,now,.025);
  if(ambientGain){const active=playing&&!paused&&!resolvingAccusation&&soundEnabled;ambientGain.gain.cancelScheduledValues(now);ambientGain.gain.setTargetAtTime(active ? .018 : 0,now,.18);}
}

function startAmbientSound() {
  const ctx=ensureAudioContext();if(!ctx||!masterGain)return;
  if(ctx.state==='suspended')void ctx.resume();
  if(!ambientStarted) {
    ambientStarted=true;ambientGain=ctx.createGain();ambientGain.gain.value=0;ambientGain.connect(masterGain);
    const hum=ctx.createOscillator();const humGain=ctx.createGain();hum.type='sine';hum.frequency.value=54;humGain.gain.value=.28;hum.connect(humGain).connect(ambientGain);hum.start();
    const buffer=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate);const channel=buffer.getChannelData(0);
    for(let index=0;index<channel.length;index++)channel[index]=Math.random()*2-1;
    const noise=ctx.createBufferSource();const filter=ctx.createBiquadFilter();const noiseGain=ctx.createGain();noise.buffer=buffer;noise.loop=true;filter.type='lowpass';filter.frequency.value=360;noiseGain.gain.value=.12;noise.connect(filter).connect(noiseGain).connect(ambientGain);noise.start();
  }
  syncAudioMix();
}

function playTone(frequency:number,duration:number,volume:number,type:OscillatorType='sine',delay=0,endFrequency=frequency) {
  const ctx=ensureAudioContext();if(!ctx||!masterGain)return;
  if(ctx.state==='suspended')void ctx.resume();
  const start=ctx.currentTime+delay;const oscillator=ctx.createOscillator();const gain=ctx.createGain();oscillator.type=type;oscillator.frequency.setValueAtTime(frequency,start);oscillator.frequency.exponentialRampToValueAtTime(Math.max(20,endFrequency),start+duration);gain.gain.setValueAtTime(.0001,start);gain.gain.exponentialRampToValueAtTime(Math.max(.0001,volume),start+.012);gain.gain.exponentialRampToValueAtTime(.0001,start+duration);oscillator.connect(gain).connect(masterGain);oscillator.start(start);oscillator.stop(start+duration+.02);
}

function playNoiseBurst(duration:number,volume:number,delay=0) {
  const ctx=ensureAudioContext();if(!ctx||!masterGain)return;
  const buffer=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*duration),ctx.sampleRate);const channel=buffer.getChannelData(0);
  for(let index=0;index<channel.length;index++)channel[index]=(Math.random()*2-1)*(1-index/channel.length);
  const source=ctx.createBufferSource();const filter=ctx.createBiquadFilter();const gain=ctx.createGain();const start=ctx.currentTime+delay;source.buffer=buffer;filter.type='bandpass';filter.frequency.value=680;filter.Q.value=.7;gain.gain.setValueAtTime(volume,start);gain.gain.exponentialRampToValueAtTime(.0001,start+duration);source.connect(filter).connect(gain).connect(masterGain);source.start(start);
}

function playInterfaceSound(kind:'click'|'mark'|'start'|'wrong'|'success'|'reveal') {
  if(kind==='click'){playTone(410,.055,.035,'triangle',0,330);return;}
  if(kind==='mark'){playTone(620,.075,.045,'sine',0,760);return;}
  if(kind==='start'){playTone(220,.18,.055,'triangle');playTone(330,.22,.045,'triangle',.09);return;}
  if(kind==='wrong'){playNoiseBurst(.2,.07);playTone(190,.28,.09,'sawtooth',0,82);return;}
  if(kind==='success'){playTone(392,.32,.07,'triangle');playTone(523.25,.38,.075,'triangle',.09);playTone(659.25,.48,.08,'triangle',.18);return;}
  playTone(293.66,.26,.045,'sine');playTone(440,.38,.06,'sine',.1);
}

function playBellSound() {
  if(!soundEnabled)return;
  [523.25,659.25,783.99].forEach((frequency,index)=>playTone(frequency,1.5,.08,'sine',index*.035,frequency*.985));
}

function updateSubject(s:Subject,dt:number,actionDt:number) {
  (Object.keys(s.cooldowns) as RuleId[]).forEach(id=>s.cooldowns[id]=Math.max(0,s.cooldowns[id]-dt));
  const observationPoint=observationPointFor(s);if(observationPoint)s.waypoint.copy(observationPoint);
  const distance=s.root.position.distanceTo(s.waypoint);
  if(!observationPoint&&distance<1.2&&trigger(s,'turnSpin'))chooseNextWaypoint(s);
  const dir=s.waypoint.clone().sub(s.root.position); dir.y=0; dir.normalize();
  const observationHolding=observationEncounter?.phase==='holding'&&(s===observationEncounter.first||s===observationEncounter.second);
  const moveFactor=observationHolding||s.action==='sideStep'||s.action==='crouch'?0:s.action==='spin'?.12:s.action==='sideKick'||s.action==='star'?.1:s.action?.42:1;
  s.root.position.addScaledVector(dir,s.speed*dt*moveFactor);
  if(dir.lengthSq()&&moveFactor>0) s.root.rotation.y=THREE.MathUtils.lerp(s.root.rotation.y,Math.atan2(dir.x,dir.z),Math.min(1,dt*4));
  const gait=Math.sin(simulationTime*s.speed*5+s.id)*.1*moveFactor;
  s.body.rotation.z=gait; s.leftArm.rotation.x=gait*2; s.rightArm.rotation.x=-gait*2;
  const inCenter=Math.hypot(s.root.position.x,s.root.position.z)<centerTriggerRadius;
  s.lastCenterInside=inCenter?(s.lastCenterInside||trigger(s,'centerCrouch')):false;
  const inEdge=Math.max(Math.abs(s.root.position.x),Math.abs(s.root.position.z))>arenaHalf*.62;
  s.lastEdgeInside=inEdge?(s.lastEdgeInside||trigger(s,'edgeStar')):false;
  const inBellZone=Math.hypot(s.root.position.x,s.root.position.z+25*arenaScale)<Math.max(2.8,5*arenaScale);
  s.lastBellZoneInside=inBellZone?(s.lastBellZoneInside||trigger(s,'bellZoneSideKick')):false;
  const lampDistance=Math.min(...([[-24,-24],[24,-24],[-24,24],[24,24]] as [number,number][]).map(([x,z])=>Math.hypot(s.root.position.x-x*arenaScale,s.root.position.z-z*arenaScale)));
  const inLampZone=lampDistance<Math.max(2.8,4.5*arenaScale);
  s.lastLampZoneInside=inLampZone?(s.lastLampZoneInside||trigger(s,'lampSideStep')):false;
  if(s.action) animateAction(s,actionDt);
}

function resetActionPose(s:Subject) {
  s.body.position.set(0,0,0);s.body.rotation.set(0,0,0);
  s.upperBody.position.y=1.78;s.upperBody.rotation.set(0,0,0);
  s.leftArm.rotation.set(0,0,0);s.rightArm.rotation.set(0,0,0);
  s.leftLeg.position.set(-.34,1.75,0);s.rightLeg.position.set(.34,1.75,0);
  s.leftLeg.rotation.set(0,0,0);s.rightLeg.rotation.set(0,0,0);
  s.leftKnee.rotation.set(0,0,0);s.rightKnee.rotation.set(0,0,0);
}

function poseEnvelope(t:number,duration:number,ramp=.2) {
  const enter=THREE.MathUtils.smootherstep(t,0,ramp);
  const exit=1-THREE.MathUtils.smootherstep(t,duration-ramp,duration);
  return Math.min(enter,exit);
}

function sideStepPose(t:number) {
  if(t<.2)return -THREE.MathUtils.smootherstep(t,0,.2);
  if(t<.55)return -1;
  if(t<.85)return THREE.MathUtils.lerp(-1,1,THREE.MathUtils.smootherstep(t,.55,.85));
  if(t<1.2)return 1;
  return THREE.MathUtils.lerp(1,0,THREE.MathUtils.smootherstep(t,1.2,ACTION_DURATION.sideStep));
}

function animateAction(s:Subject,dt:number) {
  s.actionTime+=dt;const t=s.actionTime;const action=s.action;if(!action)return;
  const duration=ACTION_DURATION[action];const heldPose=poseEnvelope(t,duration);
  if(action==='jump')s.body.position.y=Math.max(0,Math.sin(Math.min(t/duration,1)*Math.PI)*2.25);
  if(action==='wave') {
    s.rightArm.rotation.z=-2.78*heldPose;
    s.rightArm.rotation.x=Math.sin(t*15)*.95*heldPose;
    s.upperBody.rotation.z=Math.sin(t*7)*.1*heldPose;
  }
  if(action==='spin') {
    const progress=THREE.MathUtils.smootherstep(t,0,duration);
    s.leftArm.rotation.z=-Math.PI/2*heldPose;
    s.rightArm.rotation.z=Math.PI/2*heldPose;
    s.body.rotation.y=Math.PI*2*progress;
  }
  if(action==='bow')s.upperBody.rotation.x=Math.sin(Math.min(t/duration,1)*Math.PI)*.82;
  if(action==='crouch') {
    s.upperBody.position.y=THREE.MathUtils.lerp(1.78,.88,heldPose);
    s.leftLeg.position.y=s.rightLeg.position.y=THREE.MathUtils.lerp(1.75,1.08,heldPose);
    s.leftLeg.rotation.x=s.rightLeg.rotation.x=-1.35*heldPose;
    s.leftKnee.rotation.x=s.rightKnee.rotation.x=1.35*heldPose;
    s.leftLeg.rotation.z=-.32*heldPose;s.rightLeg.rotation.z=.32*heldPose;
    s.leftKnee.rotation.z=.32*heldPose;s.rightKnee.rotation.z=-.32*heldPose;
    s.leftArm.rotation.z=-.5*heldPose;s.rightArm.rotation.z=.5*heldPose;
  }
  if(action==='sideKick') {
    s.leftLeg.rotation.z=-1.42*heldPose;
    s.leftKnee.rotation.z=.12*heldPose;
    s.upperBody.rotation.z=.3*heldPose;
    s.leftArm.rotation.z=-.85*heldPose;
    s.rightArm.rotation.z=.85*heldPose;
  }
  if(action==='sideStep') {
    const side=sideStepPose(t),left=Math.max(0,-side),right=Math.max(0,side);
    s.body.position.x=side*.75;
    s.upperBody.rotation.z=-side*.16;
    s.leftLeg.rotation.z=-left*.32;s.rightLeg.rotation.z=right*.32;
    s.rightLeg.rotation.x=-left*.58;s.rightKnee.rotation.x=left*.48;
    s.leftLeg.rotation.x=-right*.58;s.leftKnee.rotation.x=right*.48;
    s.leftArm.rotation.z=side*.72;s.rightArm.rotation.z=side*.72;
  }
  if(action==='star') {
    s.body.position.y=.14*heldPose;
    s.leftArm.rotation.z=-2.25*heldPose;
    s.rightArm.rotation.z=2.25*heldPose;
    s.leftLeg.rotation.z=-.58*heldPose;
    s.rightLeg.rotation.z=.58*heldPose;
  }
  if(t>=duration){s.action=null;s.actionTime=0;resetActionPose(s);}
}

function processProximityRules() {
  for(let i=0;i<activeSubjects.length;i++) for(let j=i+1;j<activeSubjects.length;j++) {
    const a=activeSubjects[i],b=activeSubjects[j]; const d=a.root.position.distanceToSquared(b.root.position);
    if(d<7.8) {
      if(b.red) trigger(a,'redJump'); if(a.red) trigger(b,'redJump');
      if(b.blue) trigger(a,'blueSpin'); if(a.blue) trigger(b,'blueSpin');
      if(b.yellow) trigger(a,'yellowWave'); if(a.yellow) trigger(b,'yellowWave');
      if(b.hat) trigger(a,'hatBow'); if(a.hat) trigger(b,'hatBow');
    }
    if(d<4&&areFacingEachOther(a,b)) { trigger(a,'greetingWave'); trigger(b,'greetingWave'); }
  }
}

function areFacingEachOther(a:Subject,b:Subject) {
  const toB=b.root.position.clone().sub(a.root.position);toB.y=0;if(toB.lengthSq()===0)return false;toB.normalize();
  const forwardA=new THREE.Vector3(0,0,1).applyQuaternion(a.root.quaternion);forwardA.y=0;forwardA.normalize();
  const forwardB=new THREE.Vector3(0,0,1).applyQuaternion(b.root.quaternion);forwardB.y=0;forwardB.normalize();
  return forwardA.dot(toB)>.65&&forwardB.dot(toB.clone().negate())>.65;
}

function pickSubjectAt(clientX:number,clientY:number) {
  const rect=canvas.getBoundingClientRect();
  const pointer=new THREE.Vector2((clientX-rect.left)/rect.width*2-1,-((clientY-rect.top)/rect.height)*2+1);
  raycaster.setFromCamera(pointer,camera);
  const hit=raycaster.intersectObjects(pickables,false).find(result=>activeSubjectIds.has(result.object.userData.subjectId as number));
  if(hit&&hit.distance<70) return subjects[hit.object.userData.subjectId as number];
  let nearest:Subject|null=null; let nearestDistance=38*38;
  for(const subject of activeSubjects) {
    const projected=subject.root.position.clone().add(new THREE.Vector3(0,2.7,0)).project(camera);
    if(projected.z<-1||projected.z>1)continue;
    const screenX=rect.left+(projected.x+1)*rect.width/2;
    const screenY=rect.top+(1-projected.y)*rect.height/2;
    const distance=(screenX-clientX)**2+(screenY-clientY)**2;
    if(distance<nearestDistance){nearestDistance=distance;nearest=subject;}
  }
  return nearest;
}

function beginTouchPointer(event:PointerEvent) {
  if(!touchMode||!playing||paused)return;
  event.preventDefault();
  try { canvas.setPointerCapture(event.pointerId); } catch { /* Keep tracking while the pointer remains over the canvas. */ }
  activePointers.set(event.pointerId,{x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY});
  if(activePointers.size===1) mobileDragged=false;
  if(activePointers.size===2) {
    const points=[...activePointers.values()];
    previousGestureCenter.set((points[0].x+points[1].x)/2,(points[0].y+points[1].y)/2);
    previousGestureDistance=Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y);
    mobileDragged=true;
    document.body.classList.add('camera-gesture');
  }
}

function moveTouchPointer(event:PointerEvent) {
  const point=activePointers.get(event.pointerId);
  if(!touchMode||paused||!point)return;
  event.preventDefault();
  const previousX=point.x,previousY=point.y;
  point.x=event.clientX;point.y=event.clientY;
  if(activePointers.size===1) {
    const totalDistance=Math.hypot(point.x-point.startX,point.y-point.startY);
    if(totalDistance>6) {
      mobileDragged=true;
      document.body.classList.add('camera-gesture');
    }
    if(mobileDragged) {
      mobileSpherical.theta-=(point.x-previousX)*.007;
      mobileSpherical.phi=THREE.MathUtils.clamp(mobileSpherical.phi+(point.y-previousY)*.005,.45,1.28);
      applyMobileCamera();
    }
    return;
  }
  if(activePointers.size===2) {
    const points=[...activePointers.values()];
    const center=new THREE.Vector2((points[0].x+points[1].x)/2,(points[0].y+points[1].y)/2);
    const distance=Math.max(1,Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y));
    const delta=center.clone().sub(previousGestureCenter);
    if(!followedSubject) {
      const panScale=mobileSpherical.radius*.0017;
      const right=new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion);right.y=0;right.normalize();
      const forward=mobileTarget.clone().sub(camera.position);forward.y=0;forward.normalize();
      mobileTarget.addScaledVector(right,-delta.x*panScale).addScaledVector(forward,delta.y*panScale);
      const panLimit=arenaHalf*.76;mobileTarget.x=THREE.MathUtils.clamp(mobileTarget.x,-panLimit,panLimit);mobileTarget.z=THREE.MathUtils.clamp(mobileTarget.z,-panLimit,panLimit);
    }
    if(previousGestureDistance>0) mobileSpherical.radius=THREE.MathUtils.clamp(mobileSpherical.radius*previousGestureDistance/distance,15,50);
    previousGestureCenter.copy(center);previousGestureDistance=distance;
    applyMobileCamera();
  }
}

function endTouchPointer(event:PointerEvent) {
  const point=activePointers.get(event.pointerId);
  if(!touchMode||!point)return;
  event.preventDefault();
  try { if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId); } catch { /* Capture may already be released. */ }
  const wasMulti=activePointers.size>1;
  activePointers.delete(event.pointerId);
  if(!wasMulti&&!mobileDragged&&Math.hypot(event.clientX-point.startX,event.clientY-point.startY)<8) selectSubject(pickSubjectAt(event.clientX,event.clientY));
  if(activePointers.size===1) {
    const remaining=[...activePointers.values()][0];remaining.startX=remaining.x;remaining.startY=remaining.y;mobileDragged=true;
  }
  if(activePointers.size<2)previousGestureDistance=0;
  if(activePointers.size===0)document.body.classList.remove('camera-gesture');
}

function cancelTouchPointers(){activePointers.clear();previousGestureDistance=0;mobileDragged=false;document.body.classList.remove('camera-gesture');}

function preventNativeDoubleTapZoom(event:TouchEvent) {
  if(!touchMode||event.changedTouches.length!==1)return;
  const touch=event.changedTouches[0];
  const now=performance.now();
  const isDoubleTap=event.target===lastTouchEndTarget&&now-lastTouchEndTime<350&&Math.hypot(touch.clientX-lastTouchEndX,touch.clientY-lastTouchEndY)<40;
  if(isDoubleTap) {
    event.preventDefault();
    lastTouchEndTime=0;
    return;
  }
  lastTouchEndTime=now;lastTouchEndX=touch.clientX;lastTouchEndY=touch.clientY;lastTouchEndTarget=event.target;
}

function updateCamera(dt:number) {
  if(document.pointerLockElement!==canvas) return;
  if(followedSubject){applyDesktopFollowCamera();return;}
  const forward=new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion); forward.y=0; forward.normalize();
  const right=new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion); right.y=0; right.normalize();
  const move=new THREE.Vector3();
  if(keys.has('KeyW'))move.add(forward);if(keys.has('KeyS'))move.sub(forward);if(keys.has('KeyD'))move.add(right);if(keys.has('KeyA'))move.sub(right);
  if(move.lengthSq()) move.normalize().multiplyScalar((keys.has('ShiftLeft')?18:8.5)*dt);
  camera.position.add(move);camera.position.x=THREE.MathUtils.clamp(camera.position.x,-arenaHalf-2,arenaHalf+2);camera.position.z=THREE.MathUtils.clamp(camera.position.z,-arenaHalf-2,arenaHalf+2);camera.position.y=desktopCameraHeight;
}

function updateTargeting() {
  if(touchMode) {
    activeSubjects.forEach(s=>s.marker.material.opacity=selectedSubject===s?1:0);
    return;
  }
  raycaster.setFromCamera(new THREE.Vector2(0,0),camera);
  const hit=raycaster.intersectObjects(pickables,false).find(result=>activeSubjectIds.has(result.object.userData.subjectId as number));
  hovered=hit && hit.distance<45 ? subjects[hit.object.userData.subjectId as number] : null;
  activeSubjects.forEach(s=>s.marker.material.opacity=hovered===s?1:0);
  document.querySelector('#crosshair')!.classList.toggle('locked',!!hovered);
  const label=document.querySelector('#target-label')!; label.textContent=hovered?hovered.name:''; label.classList.toggle('show',!!hovered);
}

function setVerdictFeedback(kind:'success'|'wrong'|'reveal',label:string) {
  verdictFeedback.className=`verdict-feedback show ${kind}`;verdictFeedback.setAttribute('aria-hidden','false');verdictLabel.textContent=label;
  const reticle=verdictFeedback.querySelector<HTMLElement>('i');if(reticle){reticle.style.animation='none';void reticle.offsetWidth;reticle.style.removeProperty('animation');}
}

function hideVerdictFeedback() {
  verdictFeedback.className='verdict-feedback';verdictFeedback.setAttribute('aria-hidden','true');verdictLabel.textContent='';
}

function focusVerdictCamera(subject:Subject,duration=.62) {
  const target=subjectFocus(subject);const outward=camera.position.clone().sub(target);outward.y=0;
  if(outward.lengthSq()<.01)outward.set(0,0,1);outward.normalize();outward.y=.28;outward.normalize();
  const endPosition=target.clone().addScaledVector(outward,touchMode?7.2:8.2);
  const lookMatrix=new THREE.Matrix4().lookAt(endPosition,target,camera.up);const endQuaternion=new THREE.Quaternion().setFromRotationMatrix(lookMatrix);
  verdictCamera={startPosition:camera.position.clone(),endPosition,startQuaternion:camera.quaternion.clone(),endQuaternion,startedAt:performance.now(),duration};
}

function restoreVerdictCamera(position:THREE.Vector3,quaternion:THREE.Quaternion,duration=.48) {
  verdictCamera={startPosition:camera.position.clone(),endPosition:position,startQuaternion:camera.quaternion.clone(),endQuaternion:quaternion,startedAt:performance.now(),duration};
}

function updateVerdictCamera(now:number) {
  if(!verdictCamera)return;
  const progress=THREE.MathUtils.clamp((now-verdictCamera.startedAt)/(verdictCamera.duration*1000),0,1);const eased=THREE.MathUtils.smootherstep(progress,0,1);
  camera.position.lerpVectors(verdictCamera.startPosition,verdictCamera.endPosition,eased);camera.quaternion.slerpQuaternions(verdictCamera.startQuaternion,verdictCamera.endQuaternion,eased);
  if(progress>=1)verdictCamera=null;
}

function clearVerdictSequence() {
  verdictSequenceId++;resolvingAccusation=false;verdictCamera=null;hideVerdictFeedback();document.body.classList.remove('verdict-active');
}

function beginRecoverableWrongVerdict(subject:Subject) {
  const sequence=++verdictSequenceId;const returnPosition=camera.position.clone();const returnQuaternion=camera.quaternion.clone();
  resolvingAccusation=true;keys.clear();cancelTouchPointers();document.body.classList.add('verdict-active');syncAudioMix();
  subject.marker.material.color.set(0xe65b47);subject.marker.material.opacity=1;focusVerdictCamera(subject,.5);
  setVerdictFeedback('wrong',copy('오답','WRONG'));playInterfaceSound('wrong');
  window.setTimeout(()=>{
    if(sequence!==verdictSequenceId)return;
    hideVerdictFeedback();restoreVerdictCamera(returnPosition,returnQuaternion);
  },850);
  window.setTimeout(()=>{
    if(sequence!==verdictSequenceId)return;
    camera.position.copy(returnPosition);camera.quaternion.copy(returnQuaternion);verdictCamera=null;resolvingAccusation=false;document.body.classList.remove('verdict-active');syncAudioMix();
    showToast(copy(`${subject.name} 확인 완료 · 기회 ${attempts}번 남음`,`${subject.name} INSPECTED · ${attempts} CHANCE${attempts===1?'':'S'} LEFT`),true,1400);
  },1380);
}

function beginVerdict(subject:Subject,success:boolean) {
  updateRoundClock();const frozenElapsed=roundElapsedTime;const sequence=++verdictSequenceId;
  resolvingAccusation=true;playing=false;paused=false;keys.clear();cancelTouchPointers();restoreSystemCursor();setFollowSubject(null,false);selectSubject(null);syncAudioMix();
  document.body.classList.add('verdict-active');subject.marker.material.color.set(success?0xf4b942:0xe65b47);subject.marker.material.opacity=1;focusVerdictCamera(subject,.5);
  setVerdictFeedback(success?'success':'wrong',success?copy('정답','CONFIRMED'):copy('오답','WRONG'));playInterfaceSound(success?'success':'wrong');
  if(success) {
    window.setTimeout(()=>{if(sequence!==verdictSequenceId)return;roundElapsedTime=frozenElapsed;endRound(true,true)},1000);return;
  }
  window.setTimeout(()=>{
    if(sequence!==verdictSequenceId)return;
    const odd=subjects[oddId];subject.marker.material.opacity=0;odd.marker.material.color.set(0xf4b942);odd.marker.material.opacity=1;focusVerdictCamera(odd,.55);setVerdictFeedback('reveal',copy(`정답 · ${odd.name}`,`THE ODD ONE · ${odd.name}`));playInterfaceSound('reveal');
  },1700);
  window.setTimeout(()=>{if(sequence!==verdictSequenceId)return;roundElapsedTime=frozenElapsed;endRound(false,true)},2800);
}

function accuse(subject=hovered) {
  if(!playing||paused||resolvingAccusation||!subject)return;
  if(subject.inspected){showToast(copy(`${subject.name}은(는) 이미 확인했습니다.`,`${subject.name} WAS ALREADY INSPECTED.`),true,1200);return;}
  if(subject.id===oddId){beginVerdict(subject,true);return;}
  attempts--;subject.inspected=true;subject.inspectedSprite.material.opacity=1;updateAttempts();
  subject.marker.material.color.set(0xe65b47);
  if(touchMode)selectSubject(null);
  if(attempts<=0){beginVerdict(subject,false);return;}
  beginRecoverableWrongVerdict(subject);
}

function updateAttempts(){const el=document.querySelector('#attempts')!;el.innerHTML='';for(let i=0;i<attemptLimit;i++){const bar=document.createElement('i');bar.className=`attempt${i>=attempts?' lost':''}`;el.appendChild(bar)}el.setAttribute('aria-label',copy(`고발 기회 ${attempts}번 남음`,`${attempts} attempts remaining`))}
let toastTimeout=0;
function showToast(message:string,bad=false,duration=1200){const el=document.querySelector('#toast')!;el.textContent=message;el.className=`toast show${bad?' bad':''}`;clearTimeout(toastTimeout);toastTimeout=window.setTimeout(()=>el.className='toast',duration)}

function setPaused(value:boolean) {
  if(!playing||paused===value)return;
  const now=performance.now();
  if(gameMode!=='ranked') {
    if(value)casualPauseStartedAt=now;
    else if(casualPauseStartedAt){casualPausedMs+=now-casualPauseStartedAt;casualPauseStartedAt=0;}
  }
  paused=value;keys.clear();cancelTouchPointers();
  const screen=document.querySelector<HTMLElement>('#pause-screen')!;screen.classList.toggle('open',paused);screen.setAttribute('aria-hidden',String(!paused));
  document.body.classList.toggle('paused',paused);
  if(paused)restoreSystemCursor();
  if(!paused&&!touchMode)requestGamePointerLock();
  syncAudioMix();
}

function updateRoundClock(now=performance.now()) {
  if(!roundStartedAt)return;
  const currentPause=gameMode!=='ranked'&&paused&&casualPauseStartedAt?now-casualPauseStartedAt:0;
  roundElapsedTime=Math.max(0,(now-roundStartedAt-casualPausedMs-currentPause)/1000);
}

function updateSoundButtons() {
  const hudButton=document.querySelector<HTMLButtonElement>('#sound-toggle')!;
  const pauseButton=document.querySelector<HTMLButtonElement>('#pause-sound-toggle')!;
  hudButton.textContent=soundEnabled?copy('소리','SOUND'):copy('음소거','MUTED');
  pauseButton.textContent=soundEnabled?copy('소리 켜짐','SOUND ON'):copy('소리 꺼짐','SOUND OFF');
  for(const button of [hudButton,pauseButton]) {button.classList.toggle('muted',!soundEnabled);button.setAttribute('aria-pressed',String(soundEnabled));button.setAttribute('aria-label',soundEnabled?copy('소리 끄기','Turn sound off'):copy('소리 켜기','Turn sound on'));}
  const percent=Math.round(soundVolume*100);
  volumeSliders.forEach(slider=>{slider.value=String(percent);slider.style.setProperty('--volume-progress',`${percent}%`);slider.setAttribute('aria-label',copy('음량','Volume'));slider.setAttribute('aria-valuetext',`${percent}%`);});
  volumeOutputs.forEach(output=>output.textContent=`${percent}%`);
}

function setSoundVolume(volume:number) {
  soundVolume=THREE.MathUtils.clamp(volume,0,1);soundEnabled=soundVolume>0;
  if(soundEnabled)lastAudibleVolume=soundVolume;
  try {localStorage.setItem('the-odd-one-volume',String(soundVolume));} catch { /* Keep the current session volume. */ }
  updateSoundButtons();if(soundEnabled&&playing)startAmbientSound();syncAudioMix();
}

function toggleSound(){setSoundVolume(soundEnabled?0:lastAudibleVolume)}

function setSystemCursorOverride(visible:boolean) {
  for(const element of [document.documentElement,document.body,canvas]) {
    if(visible)element.style.cursor='auto';
    else element.style.removeProperty('cursor');
  }
}

function pointerLockAllowed() {
  return !touchMode&&playing&&!paused&&!altCursorMode&&!document.hidden&&document.hasFocus();
}

function clearPointerLockReleaseTimers() {
  pointerLockReleaseTimers.forEach(timer=>clearTimeout(timer));
  pointerLockReleaseTimers=[];
}

function releasePointerLockNow() {
  setSystemCursorOverride(true);
  if(document.pointerLockElement) {
    try { document.exitPointerLock(); } catch { /* The document may already be leaving Pointer Lock. */ }
  }
}

function exitGamePointerLock() {
  pointerLockRequestId++;
  pointerLockAcquired=false;
  clearPointerLockReleaseTimers();
  releasePointerLockNow();
  for(const delay of [0,50,150,400,1000]) {
    pointerLockReleaseTimers.push(window.setTimeout(()=>{
      if(!pointerLockAllowed())releasePointerLockNow();
    },delay));
  }
}

function restoreSystemCursor() {
  altCursorMode=false;keys.clear();document.body.classList.remove('cursor-free');
  setSystemCursorOverride(true);exitGamePointerLock();
}

function handleBrowserFocusLoss() {
  if(touchMode)return;
  restoreSystemCursor();
}

function requestGamePointerLock() {
  if(!pointerLockAllowed())return;
  clearPointerLockReleaseTimers();
  const requestId=++pointerLockRequestId;
  setSystemCursorOverride(false);
  try {
    const result=canvas.requestPointerLock();
    if(result instanceof Promise)result.then(()=>{
      if(requestId!==pointerLockRequestId||!pointerLockAllowed())exitGamePointerLock();
    }).catch(()=>{
      if(requestId===pointerLockRequestId)setSystemCursorOverride(true);
    });
  } catch {
    if(requestId===pointerLockRequestId)setSystemCursorOverride(true);
  }
}

function setAltCursorMode(value:boolean) {
  if(touchMode||!playing||paused)value=false;
  if(altCursorMode===value)return;
  altCursorMode=value;keys.clear();document.body.classList.toggle('cursor-free',value);
  if(value){setSystemCursorOverride(true);exitGamePointerLock();}
  else if(playing&&!paused)requestGamePointerLock();
}

function showRoundTransition() {
  roundTransition.classList.remove('show');roundTransition.setAttribute('aria-hidden','false');void roundTransition.offsetWidth;roundTransition.classList.add('show');
  window.setTimeout(()=>{roundTransition.classList.remove('show');roundTransition.setAttribute('aria-hidden','true')},850);
}

function startRound(){
  if(roundStarting)return;
  clearVerdictSequence();roundStarting=true;updateGameModeUI();
  configureRound();playing=true;paused=false;roundResult=null;completedRoundShareResult=null;pointerLockAcquired=false;altCursorMode=false;setSystemCursorOverride(false);setFollowSubject(null,false);document.body.classList.add('round-active');document.body.classList.remove('paused','cursor-free');selectSubject(null);document.querySelector('#start-screen')!.classList.remove('open');document.querySelector('#end-screen')!.classList.remove('open');document.querySelector('#pause-screen')!.classList.remove('open');tutorialIntroScreen.classList.remove('open');tutorialIntroScreen.setAttribute('aria-hidden','true');tutorialHud.hidden=gameMode!=='tutorial';if(touchMode)initializeMobileCamera();else{camera.fov=62;camera.updateProjectionMatrix();desktopCameraHeight=Math.max(8,arenaSize*.22);camera.position.set(0,desktopCameraHeight,arenaHalf*.82);yaw=0;pitch=-.28;desktopFreePosition.copy(camera.position);desktopFreeYaw=yaw;desktopFreePitch=pitch;camera.rotation.set(pitch,yaw,0);requestGamePointerLock()}
  startAmbientSound();playInterfaceSound('start');showRoundTransition();roundStarting=false;updateGameModeUI();
}

function calculateRoundScore() {
  const wrongGuesses=attemptLimit-attempts;
  const timeBonus=Math.max(0,10000-Math.floor(roundElapsedTime)*50);
  const accuracyBonus=wrongGuesses===0?5000:wrongGuesses===1?2000:0;
  return 10000+timeBonus+accuracyBonus;
}

function formatRunTime(milliseconds:number) {
  const seconds=Math.floor(milliseconds/1000);
  return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
}

function resultForSharing():SharedResult|null {
  return completedRoundShareResult?{...completedRoundShareResult}:null;
}

function buildShareUrl(result:SharedResult) {
  const url=new URL(location.href);url.hash='';url.search='';
  url.searchParams.set('result',result.mode);
  url.searchParams.set('score',String(Math.round(result.score)));
  url.searchParams.set('npc',String(result.participants));
  url.searchParams.set('time',String(Math.max(1,Math.floor(result.timeMs/1000))));
  url.searchParams.set('wrong',String(result.wrongGuesses));
  return url.toString();
}

function parseSharedResult() : SharedResult|null {
  const params=new URLSearchParams(location.search);
  const mode=params.get('result');
  const score=Number(params.get('score'));const participants=Number(params.get('npc'));const seconds=Number(params.get('time'));const wrongGuesses=Number(params.get('wrong'));
  const validMode=mode==='casual'||mode==='ranked';
  const validParticipants=participants===6||participants===9||participants===12;
  const minimumScore=mode==='ranked'?30000:10000;const maximumScore=mode==='ranked'?75000:25000;const maximumWrong=mode==='ranked'?3:1;
  if(!validMode||!validParticipants||(mode==='ranked'&&participants!==12)||!Number.isInteger(score)||score<minimumScore||score>maximumScore||!Number.isInteger(seconds)||seconds<1||seconds>86400||!Number.isInteger(wrongGuesses)||wrongGuesses<0||wrongGuesses>maximumWrong)return null;
  return {mode,score,participants,timeMs:seconds*1000,wrongGuesses};
}

function renderShareResult(result:SharedResult) {
  shareModeLabel.textContent=result.mode==='ranked'?copy('랭크 완주 · 6 → 9 → 12','RANKED CLEAR · 6 → 9 → 12'):copy(`일반 게임 · ${result.participants}명`,`CASUAL · ${result.participants} NPCS`);
  shareScoreLabel.textContent=result.score.toLocaleString();shareTimeLabel.textContent=formatRunTime(result.timeMs);shareWrongLabel.textContent=copy(`${result.wrongGuesses}회`,String(result.wrongGuesses));
}

function openShareScreen(result:SharedResult,origin:'result'|'link') {
  activeShareResult=result;renderShareResult(result);shareFeedback.textContent='';
  shareDialog.className=`share-dialog ${origin}-origin`;shareScreen.classList.add('open');shareScreen.setAttribute('aria-hidden','false');
  setTimeout(()=>document.querySelector<HTMLButtonElement>('#share-link-button')!.focus(),0);
}

function clearShareQuery() {
  const url=new URL(location.href);['result','score','npc','time','wrong'].forEach(key=>url.searchParams.delete(key));history.replaceState(null,'',url);
}

function closeShareScreen() {
  shareScreen.classList.remove('open');shareScreen.setAttribute('aria-hidden','true');
  if(shareDialog.classList.contains('link-origin'))clearShareQuery();
  activeShareResult=null;
}

async function shareActiveResult() {
  if(!activeShareResult)return;
  const url=buildShareUrl(activeShareResult);
  const modeText=activeShareResult.mode==='ranked'?copy('랭크 완주','Ranked clear'):copy(`${activeShareResult.participants}명 일반 게임`,`${activeShareResult.participants}-NPC casual game`);
  const text=copy(`THE ODD ONE ${modeText} · ${activeShareResult.score.toLocaleString()}점`,`THE ODD ONE ${modeText} · ${activeShareResult.score.toLocaleString()} points`);
  try {
    if(navigator.share){await navigator.share({title:'THE ODD ONE',text,url});shareFeedback.textContent=copy('공유했습니다.','SHARED.');}
    else {await navigator.clipboard.writeText(`${text}\n${url}`);shareFeedback.textContent=copy('결과 링크를 복사했습니다.','RESULT LINK COPIED.');}
  } catch(error) {
    if(error instanceof DOMException&&error.name==='AbortError')return;
    try {await navigator.clipboard.writeText(`${text}\n${url}`);shareFeedback.textContent=copy('결과 링크를 복사했습니다.','RESULT LINK COPIED.');}
    catch {shareFeedback.textContent=copy('공유하지 못했습니다. 다시 시도해 주세요.','COULD NOT SHARE. TRY AGAIN.');}
  }
}

function updateResultCopy(){
  const success=roundResult==='success';
  const ranked=gameMode==='ranked'&&rankedRunState!=='idle';
  const tutorial=gameMode==='tutorial';
  const resultKicker=document.querySelector<HTMLElement>('#result-kicker')!;
  const rankedStageNumber=Math.min(rankedStageIndex+1,RANKED_SEQUENCE.length);
  resultKicker.textContent=tutorial?copy(`튜토리얼 ${tutorialStageIndex+1}/${TUTORIAL_STAGES.length}`,`TUTORIAL ${tutorialStageIndex+1}/${TUTORIAL_STAGES.length}`):ranked?copy(`랭크 ${rankedStageNumber}/${RANKED_SEQUENCE.length}`,`RANKED ${rankedStageNumber}/${RANKED_SEQUENCE.length}`):(success?'':copy('관찰 종료','OBSERVATION TERMINATED'));
  resultKicker.hidden=!tutorial&&!ranked&&success;
  const resultTitle=document.querySelector('#result-title')!;
  if(tutorial&&success&&tutorialStageIndex===TUTORIAL_STAGES.length-1)resultTitle.textContent=copy('튜토리얼 완료!','TUTORIAL COMPLETE!');
  else if(tutorial&&success)resultTitle.textContent=copy(`${tutorialStageIndex+1}단계 완료`,`STAGE ${tutorialStageIndex+1} COMPLETE`);
  else if(tutorial)resultTitle.textContent=copy('다시 관찰해 보세요.','TRY OBSERVING AGAIN.');
  else if(rankedRunState==='completed')resultTitle.textContent=copy('랭크 완주!','RANKED RUN COMPLETE!');
  else if(rankedRunState==='failed')resultTitle.textContent=copy('랭크 도전 실패','RANKED RUN FAILED');
  else if(ranked&&success)resultTitle.textContent=copy(`${participantCount}명 클리어`,`CLEARED ${participantCount} NPCS`);
  else resultTitle.textContent=success?copy('찾았습니다.','YOU FOUND IT.'):copy('추리에 실패했습니다.','CASE FAILED.');
  document.querySelector('#reveal-rule')!.textContent=targetRule.label[language];
  document.querySelector('#reveal-npc')!.textContent=subjects[oddId].name;
  scoreSummary.hidden=!success||tutorial;
  scoreSummary.classList.toggle('single',!ranked);
  const roundScoreTitle=scoreSummary.querySelector<HTMLElement>('div:first-child span')!;
  roundScoreTitle.textContent=ranked?copy('이번 라운드','THIS ROUND'):copy('점수','SCORE');
  if(success){roundScoreLabel.textContent=latestRoundScore.toLocaleString();if(ranked)totalScoreLabel.textContent=rankedTotalScore.toLocaleString();}
  const canSubmit=rankedRunState==='completed'&&(rankedSaveState===null||rankedSaveState==='error');
  rankSubmitPanel.hidden=!canSubmit;
  if(canSubmit&&rankNameInput.value==='')rankNameInput.value=rankedNickname;
  shareResultButton.hidden=!resultForSharing();
  tutorialResultStatus.hidden=!tutorial;
  tutorialResultStatus.textContent=tutorial?TUTORIAL_STAGES[tutorialStageIndex].result[language]:'';
  const replayLabel=document.querySelector<HTMLButtonElement>('#replay-button')!.querySelector('span')!;
  if(tutorial&&success&&tutorialStageIndex<TUTORIAL_STAGES.length-1)replayLabel.textContent=copy('다음 단계','NEXT STAGE');
  else if(tutorial&&success)replayLabel.textContent=copy('튜토리얼 다시하기','REPLAY TUTORIAL');
  else if(tutorial)replayLabel.textContent=copy('같은 단계 다시하기','RETRY THIS STAGE');
  else if(rankedRunState==='active'&&success)replayLabel.textContent=copy(`다음: ${RANKED_SEQUENCE[rankedStageIndex+1]}명`,`NEXT: ${RANKED_SEQUENCE[rankedStageIndex+1]} NPCS`);
  else if(rankedRunState==='completed'||rankedRunState==='failed')replayLabel.textContent=copy('처음부터 다시 도전','RETRY FROM THE START');
  else replayLabel.textContent=copy('다시 플레이','PLAY AGAIN');
  updateRankedResultStatus();
}

function updateRankedResultStatus() {
  const ranked=gameMode==='ranked'&&rankedRunState!=='idle';
  rankedResultStatus.hidden=!ranked;
  rankedResultStatus.className=`ranked-result-status${rankedSaveState?` ${rankedSaveState}`:''}`;
  if(!ranked)rankedResultStatus.textContent='';
  else if(rankedSaveState==='saving')rankedResultStatus.textContent=copy('최고 점수를 저장하는 중…','SAVING HIGH SCORE…');
  else if(rankedSaveState==='saved')rankedResultStatus.textContent=copy(`최고 점수 등록 완료 · ${formatRunTime(rankedTotalTimeMs)}`,`HIGH SCORE SAVED · ${formatRunTime(rankedTotalTimeMs)}`);
  else if(rankedSaveState==='unchanged')rankedResultStatus.textContent=copy('완주 성공 · 기존 최고 점수를 유지했습니다.','RUN COMPLETE · YOUR BEST SCORE STANDS.');
  else if(rankedSaveState==='error')rankedResultStatus.textContent=copy('결과 저장에 실패했습니다. 네트워크를 확인해 주세요.','RESULT SAVE FAILED. CHECK YOUR CONNECTION.');
  else if(rankedRunState==='failed')rankedResultStatus.textContent=copy('이번 도전은 등록되지 않습니다.','THIS RUN WILL NOT BE SUBMITTED.');
  else if(rankedRunState==='active')rankedResultStatus.textContent=copy(`다음 단계 ${RANKED_SEQUENCE[rankedStageIndex+1]}명`,`NEXT STAGE: ${RANKED_SEQUENCE[rankedStageIndex+1]} NPCS`);
  else if(rankedRunState==='completed')rankedResultStatus.textContent=copy('닉네임을 입력하면 최고 점수에 등록됩니다.','ENTER A NAME TO SUBMIT YOUR HIGH SCORE.');
  else rankedResultStatus.textContent='';
}

async function saveCompletedRankedRun() {
  if(rankedRunState!=='completed'||rankedSaveState==='saving'||rankedSaveState==='saved'||rankedSaveState==='unchanged')return;
  const nickname=rankNameInput.value.trim();
  if(nickname.length<2||nickname.length>10){rankNameError.textContent=copy('닉네임을 2~10자로 입력해 주세요.','ENTER A NAME WITH 2–10 CHARACTERS.');rankNameInput.focus();return;}
  const requestId=++rankedSaveRequestId;
  const submission={score:rankedTotalScore,timeMs:rankedTotalTimeMs,wrongGuesses:rankedWrongGuesses};
  authBusy=true;rankedSaveState='saving';rankNameError.textContent='';rankSubmitButton.disabled=true;updateResultCopy();
  try {
    const user=await ensureAnonymousUser();
    if(requestId!==rankedSaveRequestId)return;
    rankedNickname=nickname;
    try { localStorage.setItem('the-odd-one-ranked-name',nickname); } catch { /* Keep the name for this session only. */ }
    const improved=await submitBestScore(user,nickname,submission.score,submission.timeMs,submission.wrongGuesses);
    if(requestId!==rankedSaveRequestId)return;
    rankedSaveState=improved?'saved':'unchanged';updateResultCopy();
  } catch(error) {
    if(requestId!==rankedSaveRequestId)return;
    console.warn('Ranked high score could not be saved.',error);
    rankedSaveState='error';rankNameError.textContent=copy('기록 등록에 실패했습니다. 다시 시도해 주세요.','COULD NOT SUBMIT THE SCORE. TRY AGAIN.');updateResultCopy();
  } finally {
    if(requestId===rankedSaveRequestId){authBusy=false;rankSubmitButton.disabled=false;updateGameModeUI();}
  }
}

function endRound(success:boolean,preserveElapsed=false){
  if(!preserveElapsed)updateRoundClock();clearVerdictSequence();playing=false;paused=false;roundResult=success?'success':'fail';restoreSystemCursor();setFollowSubject(null,false);document.body.classList.remove('round-active','paused','cursor-free');setRuleNotesOpen(false);document.querySelector('#pause-screen')!.classList.remove('open');cancelTouchPointers();selectSubject(null);subjects[oddId].marker.material.color.set(0xf4b942);subjects[oddId].marker.material.opacity=1;syncAudioMix();
  tutorialHud.hidden=true;
  latestRoundScore=success&&gameMode!=='tutorial'?calculateRoundScore():0;
  if(gameMode==='tutorial'&&success&&tutorialStageIndex===TUTORIAL_STAGES.length-1)rememberTutorialCompleted();
  if(gameMode==='ranked'&&rankedRunState==='active') {
    if(success) {
      rankedTotalScore+=latestRoundScore;rankedTotalTimeMs+=Math.max(1,Math.round(roundElapsedTime*1000));rankedWrongGuesses+=attemptLimit-attempts;
      if(rankedStageIndex===RANKED_SEQUENCE.length-1)rankedRunState='completed';
    } else {latestRoundScore=0;rankedRunState='failed';}
  }
  completedRoundShareResult=success&&gameMode==='casual'
    ?{mode:'casual',score:latestRoundScore,participants:participantCount,timeMs:Math.max(1,Math.round(roundElapsedTime*1000)),wrongGuesses:attemptLimit-attempts}
    :success&&rankedRunState==='completed'
      ?{mode:'ranked',score:rankedTotalScore,participants:12,timeMs:rankedTotalTimeMs,wrongGuesses:rankedWrongGuesses}
      :null;
  const screen=document.querySelector('#end-screen')!;screen.className=`screen result-screen open ${success?'success':'fail'}`;updateResultCopy();
}

function resetRankedRun() {
  rankedSaveRequestId++;authBusy=false;rankSubmitButton.disabled=false;
  rankedRunState='active';rankedStageIndex=0;rankedTotalScore=0;rankedTotalTimeMs=0;rankedWrongGuesses=0;latestRoundScore=0;rankedSaveState=null;rankNameError.textContent='';rankSubmitPanel.hidden=true;setParticipantCount(RANKED_SEQUENCE[0]);
}

function handleReplay() {
  if(gameMode==='tutorial') {
    if(roundResult==='success'&&tutorialStageIndex<TUTORIAL_STAGES.length-1)tutorialStageIndex++;
    else if(roundResult==='success')tutorialStageIndex=0;
    openTutorialIntro();return;
  }
  if(gameMode!=='ranked'){requestStartRound();return;}
  if(rankedRunState==='active'&&roundResult==='success') {rankedStageIndex++;setParticipantCount(RANKED_SEQUENCE[rankedStageIndex]);startRound();return;}
  resetRankedRun();requestStartRound();
}

function returnToStartScreen(){
  if(gameMode==='ranked'&&rankedRunState==='active')rankedRunState='failed';
  rankedSaveRequestId++;authBusy=false;rankSubmitButton.disabled=false;clearVerdictSequence();playing=false;paused=false;roundResult=null;completedRoundShareResult=null;restoreSystemCursor();cancelTouchPointers();setFollowSubject(null,false);selectSubject(null);syncAudioMix();
  subjects.forEach(subject=>subject.marker.material.opacity=0);
  document.querySelector('#crosshair')!.classList.remove('locked');const targetLabel=document.querySelector<HTMLElement>('#target-label')!;targetLabel.textContent='';targetLabel.classList.remove('show');
  document.body.classList.remove('round-active','paused','selection-active','cursor-free');
  setRuleNotesOpen(false);
  document.querySelector('#pause-screen')!.classList.remove('open');document.querySelector('#pause-screen')!.setAttribute('aria-hidden','true');
  document.querySelector('#end-screen')!.classList.remove('open');controlsScreen.classList.remove('open');controlsScreen.setAttribute('aria-hidden','true');rulesScreen.classList.remove('open');rulesScreen.setAttribute('aria-hidden','true');rankIntroScreen.classList.remove('open');rankIntroScreen.setAttribute('aria-hidden','true');tutorialOfferScreen.classList.remove('open');tutorialOfferScreen.setAttribute('aria-hidden','true');tutorialIntroScreen.classList.remove('open');tutorialIntroScreen.setAttribute('aria-hidden','true');tutorialHud.hidden=true;
  document.querySelector('#start-screen')!.classList.add('open');
  rankedRunState='idle';rankedSaveState=null;scoreSummary.hidden=true;rankSubmitPanel.hidden=true;rankNameError.textContent='';
  tutorialResultStatus.hidden=true;
  if(gameMode==='tutorial'){setGameMode('casual');setParticipantCount(6);}
  clearTimeout(toastTimeout);document.querySelector('#toast')!.className='toast';
}

document.querySelector('#play-button')!.addEventListener('click',requestSelectedModeStart);
tutorialOfferStartButton.addEventListener('click',acceptTutorialOffer);
tutorialOfferSkipButton.addEventListener('click',skipTutorialOffer);
tutorialButton.addEventListener('click',beginTutorial);
tutorialStartButton.addEventListener('click',startTutorialStage);
document.querySelector('#tutorial-cancel-button')!.addEventListener('click',closeTutorialIntroToHome);
document.querySelector('#replay-button')!.addEventListener('click',handleReplay);
document.querySelector('#result-home-button')!.addEventListener('click',returnToStartScreen);
shareResultButton.addEventListener('click',()=>{const result=resultForSharing();if(result)openShareScreen(result,'result')});
document.querySelector('#share-link-button')!.addEventListener('click',()=>void shareActiveResult());
document.querySelector('#share-close-button')!.addEventListener('click',closeShareScreen);
document.querySelector('#share-play-button')!.addEventListener('click',()=>{closeShareScreen();document.querySelector<HTMLButtonElement>('#play-button')!.focus()});
participantButtons.forEach(button=>button.addEventListener('click',()=>{
  const count=Number(button.dataset.participantCount);
  if(count===6||count===9||count===12)setParticipantCount(count);
}));
ruleNoteRows.forEach(row=>row.addEventListener('click',()=>cycleRuleNote(row.dataset.ruleNote as RuleNoteId)));
document.querySelector('#rule-notes-close')!.addEventListener('click',()=>setRuleNotesOpen(false));
ruleNotesToggle.addEventListener('click',()=>setRuleNotesOpen(true));
canvas.addEventListener('click',event=>{if(event.button!==0||performance.now()<suppressAccusationUntil||touchMode||!playing||altCursorMode)return;if(document.pointerLockElement!==canvas)requestGamePointerLock();else accuse()});
canvas.addEventListener('contextmenu',event=>event.preventDefault());
canvas.addEventListener('pointerdown',event=>{if(!touchMode&&event.button===2){event.preventDefault();suppressAccusationUntil=performance.now()+400;if(playing&&!paused&&hovered)cycleSubjectMark(hovered)}});
canvas.addEventListener('pointerdown',beginTouchPointer);
canvas.addEventListener('pointermove',moveTouchPointer);
canvas.addEventListener('pointerup',endTouchPointer);
canvas.addEventListener('pointercancel',cancelTouchPointers);
document.addEventListener('touchend',preventNativeDoubleTapZoom,{passive:false});
document.addEventListener('dblclick',event=>{if(touchMode)event.preventDefault()},{passive:false});
document.querySelector('#mobile-accuse')!.addEventListener('click',()=>accuse(selectedSubject));
questionButton.addEventListener('click',()=>{if(selectedSubject){setSubjectMark(selectedSubject,selectedSubject.mark==='?'?null:'?');playInterfaceSound('mark')}});
clearButton.addEventListener('click',()=>{if(selectedSubject){setSubjectMark(selectedSubject,selectedSubject.mark==='✓'?null:'✓');playInterfaceSound('mark')}});
followButton.addEventListener('click',()=>toggleFollow(selectedSubject));
document.querySelector('#resume-button')!.addEventListener('click',()=>setPaused(false));
mobilePauseButton.addEventListener('click',()=>setPaused(true));
document.querySelector('#view-controls-button')!.addEventListener('click',()=>openControls('pause'));
document.querySelector('#end-observation-button')!.addEventListener('click',returnToStartScreen);
controlsCloseButton.addEventListener('click',closeControls);
rulesContinueButton.addEventListener('click',closeRules);
document.querySelectorAll('#sound-toggle,#pause-sound-toggle').forEach(button=>button.addEventListener('click',toggleSound));
volumeSliders.forEach(slider=>slider.addEventListener('input',()=>setSoundVolume(Number(slider.value)/100)));
languageToggle.addEventListener('click',toggleLanguage);
speedButtons.forEach(button=>button.addEventListener('click',()=>{
  const speed=Number(button.dataset.gameSpeed);
  if(speed===1||speed===1.5||speed===2)setGameSpeed(speed);
}));
gameModeButtons.forEach(button=>button.addEventListener('click',()=>selectGameMode(button.dataset.gameMode as GameMode)));
rankStartButton.addEventListener('click',beginRankedRun);
document.querySelector('#rank-cancel-button')!.addEventListener('click',closeRankIntro);
rankSubmitButton.addEventListener('click',()=>void saveCompletedRankedRun());
rankNameInput.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void saveCompletedRankedRun();}});
document.querySelector('#leaderboard-button')!.addEventListener('click',openLeaderboard);
document.querySelector('#leaderboard-close')!.addEventListener('click',closeLeaderboard);
document.addEventListener('click',event=>{
  const button=(event.target as Element|null)?.closest('button');
  if(!button||button===questionButton||button===clearButton||button.matches('.rule-note,#mobile-accuse,#play-button,#replay-button'))return;
  playInterfaceSound('click');
});
addEventListener('mousemove',e=>{if(document.pointerLockElement!==canvas)return;if(followedSubject){desktopFollowSpherical.theta-=e.movementX*.0028;desktopFollowSpherical.phi=THREE.MathUtils.clamp(desktopFollowSpherical.phi-e.movementY*.0028,.35,1.4);applyDesktopFollowCamera();return}yaw-=e.movementX*.0022;pitch-=e.movementY*.0022;pitch=THREE.MathUtils.clamp(pitch,-1.35,1.35);camera.rotation.set(pitch,yaw,0)});
addEventListener('keydown',e=>{if(leaderboardScreen.classList.contains('open')){if(e.code==='Escape'){e.preventDefault();closeLeaderboard()}return}if(tutorialOfferScreen.classList.contains('open')){if(e.code==='Escape'){e.preventDefault();closeTutorialOffer()}return}if(tutorialIntroScreen.classList.contains('open')){if(e.code==='Escape'){e.preventDefault();closeTutorialIntroToHome()}return}if(rulesScreen.classList.contains('open')){if(e.code==='Escape')e.preventDefault();return}if(controlsScreen.classList.contains('open')){e.preventDefault();if(e.code==='Escape'&&controlsOrigin==='pause')closeControls();return}if((e.code==='AltLeft'||e.code==='AltRight')&&playing&&!paused&&!touchMode){e.preventDefault();if(!e.repeat)setAltCursorMode(!altCursorMode);return}if(e.code==='Escape'&&playing){e.preventDefault();if(paused)setPaused(false);else if(touchMode||document.pointerLockElement!==canvas)setPaused(true);return}const noteIndex=['Digit1','Digit2','Digit3','Digit4'].indexOf(e.code);if(noteIndex>=0&&noteIndex<activeRules.length&&playing&&!paused&&!e.repeat){e.preventDefault();cycleRuleNote(RULE_NOTE_ORDER[noteIndex]);return}if((e.code==='PageUp'||e.code==='PageDown')&&playing&&!paused&&!touchMode){e.preventDefault();adjustDesktopZoom(e.code==='PageUp'?-1:1);return}if(e.code==='KeyF'&&playing&&!paused&&!touchMode&&!e.repeat){e.preventDefault();toggleFollow(hovered||followedSubject);return}if(!paused)keys.add(e.code)});addEventListener('keyup',e=>keys.delete(e.code));
addEventListener('wheel',e=>{if(!touchMode&&playing&&!paused){e.preventDefault();adjustDesktopZoom(Math.sign(e.deltaY))}},{passive:false});
document.addEventListener('pointerlockchange',()=>{
  if(document.pointerLockElement===canvas) {
    if(!pointerLockAllowed()){exitGamePointerLock();return}
    pointerLockAcquired=true;return;
  }
  const lostGamePointerLock=pointerLockAcquired;pointerLockAcquired=false;
  if(playing&&!paused&&!altCursorMode&&lostGamePointerLock)setTimeout(()=>{
    if(playing&&!paused&&!altCursorMode&&document.hasFocus()&&!document.hidden)setPaused(true);
  },0);
});
document.addEventListener('pointerlockerror',()=>{pointerLockAcquired=false;setSystemCursorOverride(true)});
addEventListener('blur',handleBrowserFocusLoss);
document.addEventListener('visibilitychange',()=>{if(document.hidden)handleBrowserFocusLoss()});
addEventListener('pagehide',restoreSystemCursor);
addEventListener('beforeunload',restoreSystemCursor);
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;if(touchMode)camera.fov=innerHeight>innerWidth?72:62;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);if(touchMode&&!resolvingAccusation&&!verdictCamera)applyMobileCamera()});

applyLanguage();
const incomingSharedResult=parseSharedResult();if(incomingSharedResult)openShareScreen(incomingSharedResult,'link');
const clock=new THREE.Clock(); let proximityTimer=0;
function frame(){
  requestAnimationFrame(frame);if(!pointerLockAllowed()&&document.pointerLockElement)releasePointerLockNow();const realDt=Math.min(clock.getDelta(),.05);const now=performance.now();
  dust.rotation.y+=realDt*.006;dust.position.y=Math.sin(now*.00017)*.05;
  lampLights.forEach((lamp,index)=>lamp.intensity=17*(.97+Math.sin(now*.0007+index*1.73)*.025));
  if(verdictCamera)updateVerdictCamera(now);
  if(playing){updateRoundClock();document.querySelector('#timer')!.textContent=`${String(Math.floor(roundElapsedTime/60)).padStart(2,'0')}:${String(Math.floor(roundElapsedTime%60)).padStart(2,'0')}`;}
  if(playing&&!paused&&!resolvingAccusation){
    const simulationDt=realDt*gameSpeed;const actionDt=realDt*Math.sqrt(gameSpeed);simulationTime+=simulationDt;if(bellEnabled)bellTimer-=simulationDt;bell.scale.lerp(new THREE.Vector3(1,1,1),simulationDt*5);
    if(bellVisualTime>0){bellVisualTime=Math.max(0,bellVisualTime-simulationDt);bell.rotation.z=Math.sin((1.2-bellVisualTime)*25)*bellVisualTime*.16;}else bell.rotation.z=THREE.MathUtils.lerp(bell.rotation.z,0,Math.min(1,simulationDt*7));
    if(bellEnabled&&bellTimer<=0)ringBell();updateObservationScheduler(simulationDt);activeSubjects.forEach(s=>updateSubject(s,simulationDt,actionDt));proximityTimer-=simulationDt;
    if(proximityTimer<=0){processProximityRules();proximityTimer=.18}
    if(touchMode&&followedSubject)applyMobileCamera();else if(!touchMode)updateCamera(realDt);updateTargeting();
  }
  renderer.render(scene,camera);
}
frame();
