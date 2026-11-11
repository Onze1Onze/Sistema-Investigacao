import OBR from "https://esm.sh/@owlbear-rodeo/sdk@3.1.0";

const APP_ID = "com.onze1onze.sistemainvestigacao";
const META_KEY = APP_ID + "/workspace-v3";
const LOCAL_KEY = "sai-investigation-workspace-v3";
const PRIVATE_KEY = "sai-investigation-private-v1";
const CLIENT_ID = "sai-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
const BROADCAST_CHANNEL = APP_ID + "/interactions-v1";
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
const uid = (prefix="id") => prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2,8);
const clone = (v) => JSON.parse(JSON.stringify(v));
const safeSrc = (src) => {
  const s = String(src || "");
  return /^(https:\/\/|data:image\/|data:audio\/|data:application\/pdf)/i.test(s) ? s : "";
};
const viewport = $("viewport");
const world = $("world");
const itemLayer = $("item-layer");
const pinLayer = $("pin-layer");
const markLayer = $("mark-layer");
const wireLayer = $("wire-layer");
const inspectorContent = $("inspector-content");
const inspector = $("inspector");
const inspectorTitle = $("inspector-title");

let OBR_API = null;
let isOwlbear = false;
let sceneReady = false;
let isGM = true;
let canEdit = true;
let currentTool = "select";
let currentPanel = "properties";
let selectedIds = [];
let wireStart = null;
let drag = null;
let pan = null;
let marquee = null;
let drawState = null;
let zoom = 1;
let tx = 0;
let ty = 0;
let saveTimer = 0;
let toastTimer = 0;
let saveBusy = false;
let pendingSave = false;
let remoteTimestamp = 0;
let fileTarget = "image";
let privateData = {};
let audioContext = null;
let ambientNodes = null;
let particlesTimer = 0;
let lastActivity = Date.now();
let lowPower = false;
let fxRaf = 0;
let torchPoint = {x:50,y:50};
let lensVisible = false;
let lensZoom = 2.2;
let minimapVisible = true;
let boardState = null;
let workspace = null;
let undoStack = [];
let redoStack = [];
let roleName = "Investigador";

function createBoard(name) {
  return {
    id:uid("case"),
    name:name || "Novo caso investigativo",
    status:"CASO ABERTO",
    version:3,
    createdAt:Date.now(),
    updatedAt:Date.now(),
    writer:"",
    camera:{x:0,y:0,zoom:0.72},
    surface:"default",
    nodes:[],
    wires:[],
    marks:[],
    settings:{
      light:{mode:"none",color:"#ffd9a0",intensity:60,direction:"c",radius:230},
      uv:false,lamp:false,torch:false,
      effects:{fog:false,ash:false,web:false,blood:false,wisp:false,mask:false,bats:false,eyes:false,rain:false,snow:false,embers:false,ectoplasm:false,smoke:false},
      audio:{muted:false,general:45,items:70,effects:45,voices:70,ambience:"none"},
      sanity:{enabled:false,value:100}
    }
  };
}
function createWorkspace() {
  const first = createBoard();
  return {version:3,activeId:first.id,boards:[{id:first.id,name:first.name,data:first}]};
}
function normalizeBoard(b) {
  const n = b && typeof b === "object" ? b : createBoard();
  const base = createBoard(n.name || "Caso importado");
  const out = Object.assign(base,n);
  out.nodes = Array.isArray(n.nodes) ? n.nodes : [];
  out.wires = Array.isArray(n.wires) ? n.wires : [];
  out.marks = Array.isArray(n.marks) ? n.marks : [];
  out.settings = Object.assign(base.settings,n.settings || {});
  out.settings.light = Object.assign(base.settings.light,(n.settings && n.settings.light) || {});
  out.settings.effects = Object.assign(base.settings.effects,(n.settings && n.settings.effects) || {});
  out.settings.audio = Object.assign(base.settings.audio,(n.settings && n.settings.audio) || {});
  out.settings.sanity = Object.assign(base.settings.sanity,(n.settings && n.settings.sanity) || {});
  out.camera = Object.assign(base.camera,n.camera || {});
  out.nodes.forEach((node) => {
    node.id = node.id || uid("ev");
    node.x = Number.isFinite(node.x) ? node.x : 100;
    node.y = Number.isFinite(node.y) ? node.y : 100;
    node.w = Number.isFinite(node.w) ? node.w : 230;
    node.h = Number.isFinite(node.h) ? node.h : 160;
    node.rotation = Number(node.rotation || 0);
    node.z = Number(node.z || 1);
    node.pins = Array.isArray(node.pins) ? node.pins : [];
    node.props = node.props && typeof node.props === "object" ? node.props : {};
  });
  return out;
}
function normalizeWorkspace(raw) {
  if (raw && Array.isArray(raw.boards) && raw.boards.length) {
    const boards = raw.boards.map((entry) => {
      const data = normalizeBoard(entry.data || entry.board || entry);
      return {id:entry.id || data.id,name:entry.name || data.name,data:data};
    });
    const activeId = boards.some((b) => b.id === raw.activeId) ? raw.activeId : boards[0].id;
    return {version:3,activeId:activeId,boards:boards};
  }
  if (raw && Array.isArray(raw.nodes)) {
    const migrated = normalizeBoard(raw);
    return {version:3,activeId:migrated.id,boards:[{id:migrated.id,name:migrated.name,data:migrated}]};
  }
  return createWorkspace();
}
function activeBoardEntry() {
  return workspace.boards.find((b) => b.id === workspace.activeId) || workspace.boards[0];
}
function bindActiveBoard() {
  const entry = activeBoardEntry();
  workspace.activeId = entry.id;
  boardState = entry.data;
}
function loadLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) workspace = normalizeWorkspace(JSON.parse(raw));
    else {
      const legacy = localStorage.getItem("sistema-investigacao-board-v1");
      workspace = normalizeWorkspace(legacy ? JSON.parse(legacy) : null);
    }
  } catch (error) {
    console.warn("Não foi possível recuperar o salvamento local.",error);
    workspace = createWorkspace();
  }
  try {
    const secrets = localStorage.getItem(PRIVATE_KEY);
    privateData = secrets ? JSON.parse(secrets) : {};
  } catch (error) { privateData = {}; }
  bindActiveBoard();
}
function persistPrivate() {
  try { localStorage.setItem(PRIVATE_KEY,JSON.stringify(privateData)); }
  catch (error) { toast("O espaço local para segredos está cheio. Exporte os dados de mestre."); }
}
function publicWorkspace() {
  const safe = clone(workspace);
  safe.boards = safe.boards.map((entry) => {
    const data = normalizeBoard(entry.data);
    data.nodes = data.nodes.filter((node) => !node.gmOnly);
    const ids = new Set(data.nodes.map((node) => node.id));
    data.wires = data.wires.filter((wire) => ids.has(wire.from.nodeId) && ids.has(wire.to.nodeId));
    data.writer = CLIENT_ID;
    return {id:entry.id,name:entry.name,data:data};
  });
  safe.writer = CLIENT_ID;
  safe.updatedAt = Date.now();
  return safe;
}
function updateWorkspaceReference() {
  const entry = activeBoardEntry();
  if (entry) {
    entry.data = boardState;
    entry.name = boardState.name;
  }
}
async function persistNow() {
  if (saveBusy) { pendingSave = true; return; }
  saveBusy = true;
  pendingSave = false;
  updateWorkspaceReference();
  workspace.updatedAt = Date.now();
  try {
    localStorage.setItem(LOCAL_KEY,JSON.stringify(workspace));
    $("save-status").textContent = "Salvo neste dispositivo";
    $("save-dot").classList.add("ok");
  } catch (error) {
    $("save-status").textContent = "Armazenamento local cheio";
    $("save-dot").classList.remove("ok");
    toast("O armazenamento local está cheio. Exporte uma cópia do caso.");
  }
  if (OBR_API && sceneReady && isGM) {
    try {
      const packet = publicWorkspace();
      await OBR_API.scene.setMetadata({[META_KEY]:packet});
      remoteTimestamp = packet.updatedAt;
      $("save-status").textContent = "Mesa salva na cena";
      $("save-dot").classList.add("ok");
    } catch (error) {
      $("save-status").textContent = "Falha na sincronização";
      $("save-dot").classList.remove("ok");
      console.warn("Erro ao salvar metadados da cena.",error);
    }
  }
  saveBusy = false;
  if (pendingSave) persistNow();
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow,450);
}
function remember() {
  undoStack.push(clone(boardState));
  if (undoStack.length > 60) undoStack.shift();
  redoStack = [];
}
function undo() {
  if (!undoStack.length) return toast("Nada para desfazer.");
  redoStack.push(clone(boardState));
  boardState = normalizeBoard(undoStack.pop());
  updateWorkspaceReference(); selectedIds = []; renderAll(); scheduleSave(); toast("Última alteração desfeita.");
}
function redo() {
  if (!redoStack.length) return toast("Nada para refazer.");
  undoStack.push(clone(boardState));
  boardState = normalizeBoard(redoStack.pop());
  updateWorkspaceReference(); selectedIds = []; renderAll(); scheduleSave(); toast("Alteração refeita.");
}
function toast(message) {
  const box = $("toast");
  box.textContent = message;
  box.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove("show"),2800);
}
function getNode(id) { return boardState.nodes.find((node) => node.id === id); }
function getSelected() { return selectedIds.map(getNode).filter(Boolean); }
function secretFor(nodeId) {
  if (!privateData[nodeId]) privateData[nodeId] = {};
  return privateData[nodeId];
}
function randomCode(length=3) {
  let out = "";
  for (let i=0;i<length;i++) out += String(Math.floor(Math.random()*10));
  return out;
}
function objectCatalog() {
  return [
    {type:"safe",name:"Cofre de combinação",icon:"🔐",category:"Enigmas",desc:"Disco numérico configurável."},
    {type:"lockbox",name:"Maleta trancada",icon:"💼",category:"Enigmas",desc:"Fechadura protegida por senha."},
    {type:"radio",name:"Rádio de emergência",icon:"📻",category:"Enigmas",desc:"Sintonize a frequência correta."},
    {type:"crystal",name:"Bola de cristal",icon:"🔮",category:"Ocultismo",desc:"Uma visão aguarda ser revelada."},
    {type:"tarot",name:"Tarô",icon:"🃏",category:"Ocultismo",desc:"Tiragem de três cartas."},
    {type:"scale",name:"Balança de Anúbis",icon:"⚖️",category:"Egito",desc:"Equilibre o coração e a pena."},
    {type:"ouija",name:"Tábua Ouija",icon:"🜏",category:"Ocultismo",desc:"Movimente a prancheta e registre uma mensagem."},
    {type:"musicbox",name:"Caixa de música",icon:"🎼",category:"Mecanismos",desc:"Manivela e melodia interrompida."},
    {type:"pendulum",name:"Pêndulo",icon:"🔻",category:"Equipamentos",desc:"Instrumento de detecção oscilante."},
    {type:"emf",name:"Medidor EMF",icon:"📟",category:"Equipamentos",desc:"Leitura de atividade paranormal."},
    {type:"thermometer",name:"Termômetro",icon:"🌡️",category:"Equipamentos",desc:"Mede quedas de temperatura."},
    {type:"candle",name:"Vela",icon:"🕯️",category:"Ocultismo",desc:"Acenda ou apague a chama."},
    {type:"incense",name:"Incenso",icon:"〰️",category:"Ocultismo",desc:"Fumaça e fragrância ritualística."},
    {type:"cauldron",name:"Caldeirão",icon:"⚗️",category:"Ocultismo",desc:"Misture ingredientes e revele o resultado."},
    {type:"skull",name:"Crânio falante",icon:"💀",category:"Ocultismo",desc:"Um crânio com uma mensagem."},
    {type:"mirror",name:"Espelho negro",icon:"🪞",category:"Vampiros",desc:"Revela uma imagem escondida."},
    {type:"vampireMirror",name:"Espelho de vampiro",icon:"🪞",category:"Vampiros",desc:"O reflexo pode estar ausente."},
    {type:"holyWater",name:"Água benta",icon:"⚱️",category:"Vampiros",desc:"Frasco de água consagrada."},
    {type:"pocketWatch",name:"Relógio de bolso",icon:"⌚",category:"Mecanismos",desc:"Relógio com ponteiro interativo."},
    {type:"hourglass",name:"Ampulheta",icon:"⌛",category:"Mecanismos",desc:"Contagem regressiva visual."},
    {type:"kitchenTimer",name:"Timer de cozinha",icon:"⏲️",category:"Mecanismos",desc:"Disco de tempo giratório."},
    {type:"vhs",name:"Videocassete VHS",icon:"📼",category:"Tecnologia",desc:"Reproduza uma fita de vídeo."},
    {type:"tv",name:"Televisor antigo",icon:"📺",category:"Tecnologia",desc:"Tela com interferência e imagem."},
    {type:"portal",name:"Portal / Boca",icon:"🕳️",category:"Ocultismo",desc:"Abra e feche uma passagem."},
    {type:"mask",name:"Máscara vestida",icon:"🎭",category:"Efeitos",desc:"Ative uma máscara de tela."},
    {type:"wisp",name:"Fogo-fátuo",icon:"✨",category:"Efeitos",desc:"Uma luz espectral flutuante."},
    {type:"cat",name:"Gato de olhos brilhantes",icon:"🐈‍⬛",category:"Halloween",desc:"Os olhos aparecem no escuro."},
    {type:"ankh",name:"Ankh",icon:"☥",category:"Egito",desc:"Símbolo ritualístico egípcio."},
    {type:"hieroglyph",name:"Discos de hieróglifos",icon:"☼",category:"Egito",desc:"Discos giratórios com símbolos."},
    {type:"brickWall",name:"Parede de tijolos",icon:"🧱",category:"Mecanismos",desc:"Uma parede pode esconder um mecanismo."},
    {type:"pouch",name:"Saquinho de ervas",icon:"🧿",category:"Ocultismo",desc:"Um objeto com cheiro e conteúdo."},
    {type:"mirrorBlack",name:"Espelho negro grande",icon:"◩",category:"Vampiros",desc:"Visão ampliada e reflexo oculto."},
    {type:"switch",name:"Chave liga/desliga",icon:"⏻",category:"Mecanismos",desc:"Interruptor com estado salvo."},
    {type:"dial",name:"Módulo de disco",icon:"◉",category:"Mecanismos",desc:"Seletor rotativo."},
    {type:"slider",name:"Módulo deslizante",icon:"↔",category:"Mecanismos",desc:"Controle de posição linear."},
    {type:"bulb",name:"Lâmpada",icon:"💡",category:"Mecanismos",desc:"Lâmpada com interruptor."},
    {type:"key",name:"Chave antiga",icon:"🗝️",category:"Objetos",desc:"Pode ser encaixada em objetos compatíveis."},
    {type:"coin",name:"Moeda antiga",icon:"🪙",category:"Objetos",desc:"Evidência metálica reversível."},
    {type:"trigger",name:"Ativador oculto",icon:"◈",category:"Mecanismos",desc:"Gatilho visível apenas ao mestre."},
    {type:"tree",name:"Fio condutor / árvore",icon:"🌳",category:"Investigação",desc:"Nós de pistas com estados bloqueado, disponível e resolvido."}
  ];
}
const catalog = objectCatalog();
function objectInfo(type) { return catalog.find((item) => item.type === type) || {type:type,name:"Objeto de evidência",icon:"◈",category:"Objetos",desc:"Objeto investigativo."}; }
function nodeDefaults(type,extra={}) {
  const p = screenToWorld(viewport.clientWidth/2,viewport.clientHeight/2);
  const x = clamp(p.x-115+Math.random()*55,20,4500);
  const y = clamp(p.y-80+Math.random()*55,20,3500);
  const base = {
    id:uid("ev"),type:type,title:"Nova evidência",body:"Registre aqui as informações encontradas.",
    x:x,y:y,w:230,h:170,rotation:0,z:boardState.nodes.reduce((m,n)=>Math.max(m,n.z||0),0)+1,
    pins:[{id:uid("pin"),x:205,y:38,label:"Evidência"}],
    locked:false,gmOnly:false,uvSecret:false,uvText:"",frontBody:"",backBody:"",face:"front",
    filename:"SAI · EVIDÊNCIA",src:"",mime:"",props:{}
  };
  const types = {
    document:{title:"Novo documento",body:"NOME DO DOCUMENTO\n\nRegistre aqui uma transcrição, observação ou pista.",w:250,h:260},
    note:{title:"Nova anotação",body:"Uma descoberta importante...",w:190,h:145},
    image:{title:"Fotografia de evidência",body:"",w:260,h:205},
    map:{title:"Mapa com névoa",body:"",w:380,h:290,props:{fogStrokes:[]}},
    book:{title:"Caderno de investigação",body:"Anotações de campo.",w:260,h:300,props:{pages:[{title:"Página 1",body:"Anotações de campo."}],page:0}},
    leaf:{title:"Folha arrancada",body:"Uma anotação manuscrita...",w:230,h:250},
    tape:{title:"Fita adesiva",body:"",w:150,h:30,pins:[]},
    scratch:{title:"Raspadinha",body:"Mensagem escondida",w:205,h:125,props:{progress:0,revealed:false}},
    audio:{title:"Gravação de áudio",body:"",w:250,h:130},
    pdf:{title:"Documento PDF",body:"",w:240,h:170}
  };
  Object.assign(base,types[type] || {});
  return Object.assign(base,extra);
}
function addNode(type,extra={}) {
  if (!canEdit) return toast("Apenas o mestre pode modificar a mesa compartilhada.");
  remember();
  const node = nodeDefaults(type,extra);
  boardState.nodes.push(node);
  selectedIds = [node.id];
  setTool("select");
  renderAll();
  scheduleSave();
  if (type === "object") {
    const sec = secretFor(node.id);
    if (node.props.objectType === "safe") sec.code = randomCode(3);
    if (node.props.objectType === "lockbox") sec.password = "EVIDENCIA";
    if (node.props.objectType === "radio") sec.frequency = "147.30";
    if (node.props.objectType === "crystal") sec.vision = "Uma silhueta observa do outro lado da janela.";
    if (node.props.objectType === "skull") sec.message = "O que foi enterrado ainda se lembra de vocês.";
    if (node.props.objectType === "tree") node.props.treeState = "available";
    persistPrivate();
  }
  toast("Evidência adicionada ao quadro.");
  return node;
}
function addObject(type) {
  const info = objectInfo(type);
  return addNode("object",{title:info.name,label:info.category,w:205,h:205,props:{objectType:type,objectState:"idle",activated:false,treeState:type==="tree"?"available":"locked"}});
}
function setTool(tool) {
  currentTool = tool;
  wireStart = null;
  document.querySelectorAll("[data-tool]").forEach((button) => button.classList.toggle("active",button.dataset.tool === tool));
  viewport.style.cursor = tool === "wire" || tool === "pin" || tool === "fog" || tool === "reveal" || tool === "mark" ? "crosshair" : tool === "pan" ? "grab" : tool === "lens" ? "zoom-in" : "default";
  toast("Ferramenta: " + ({select:"Mover",pan:"Mover mesa",pin:"Pin",wire:"Fio",note:"Nota",image:"Imagem",mark:"Marcação",tape:"Fita",scratch:"Raspadinha",object:"Objetos",lens:"Lupa",fog:"Névoa",reveal:"Revelar"}[tool] || tool));
}
function screenToWorld(x,y) {
  const rect = viewport.getBoundingClientRect();
  return {x:(x-rect.left-tx)/zoom,y:(y-rect.top-ty)/zoom};
}
function updateTransform() {
  world.style.transform = "translate(" + tx + "px," + ty + "px) scale(" + zoom + ")";
  $("zoom-label").textContent = Math.round(zoom*100) + "%";
  boardState.camera = {x:tx,y:ty,zoom:zoom};
  renderMinimap();
}
function frameBoard() {
  if (!boardState) return;
  const nodes = boardState.nodes.filter((node) => !node.gmOnly || isGM);
  if (!nodes.length) {
    zoom = Math.min(1.1,Math.max(.35,Math.min(viewport.clientWidth/1600,viewport.clientHeight/1100)));
    tx = (viewport.clientWidth-5000*zoom)/2;
    ty = (viewport.clientHeight-4000*zoom)/2;
  } else {
    const minX = Math.min(...nodes.map((n) => n.x));
    const minY = Math.min(...nodes.map((n) => n.y));
    const maxX = Math.max(...nodes.map((n) => n.x+n.w));
    const maxY = Math.max(...nodes.map((n) => n.y+n.h));
    const w = maxX-minX+180,h=maxY-minY+180;
    zoom = clamp(Math.min(viewport.clientWidth/w,viewport.clientHeight/h),.25,1.1);
    tx = (viewport.clientWidth-w*zoom)/2-minX*zoom+90*zoom;
    ty = (viewport.clientHeight-h*zoom)/2-minY*zoom+90*zoom;
  }
  updateTransform();
}
function renderWires() {
  const html = [];
  boardState.wires.forEach((wire) => {
    const aNode = getNode(wire.from.nodeId),bNode = getNode(wire.to.nodeId);
    if (!aNode || !bNode || ((!isGM) && (aNode.gmOnly || bNode.gmOnly))) return;
    const ap = (aNode.pins||[]).find((p) => p.id === wire.from.pinId);
    const bp = (bNode.pins||[]).find((p) => p.id === wire.to.pinId);
    if (!ap || !bp) return;
    const x1=aNode.x+ap.x+8,y1=aNode.y+ap.y+8,x2=bNode.x+bp.x+8,y2=bNode.y+bp.y+8;
    const bend=Math.max(65,Math.abs(x2-x1)*.42),sign=x2>=x1?1:-1;
    const d="M "+x1+" "+y1+" C "+(x1+bend*sign)+" "+(y1+45)+" "+(x2-bend*sign)+" "+(y2+45)+" "+x2+" "+y2;
    html.push('<path class="wire-line glow" d="'+d+'"></path>');
    html.push('<path class="wire-line '+(selectedIds.includes(wire.id)?"selected":"")+'" d="'+d+'"></path>');
    html.push('<path class="wire-hit" data-wire-id="'+esc(wire.id)+'" d="'+d+'"></path>');
  });
  if (wireStart && drag && drag.pointer) {
    const node=getNode(wireStart.nodeId),pin=node && (node.pins||[]).find((p)=>p.id===wireStart.pinId);
    if (node && pin) html.push('<path class="wire-line selected" d="M '+(node.x+pin.x+8)+' '+(node.y+pin.y+8)+' Q '+drag.pointer.x+' '+(drag.pointer.y-45)+' '+drag.pointer.x+' '+drag.pointer.y+'"></path>');
  }
  wireLayer.innerHTML=html.join("");
}
function objectInside(node) {
  const type=node.props.objectType || "object";
  const info=objectInfo(type);
  const st=node.props.objectState || "idle";
  const buttons = {
    safe:'<button class="object-action" data-item-action="safe-open">Girar disco</button>',
    lockbox:'<button class="object-action" data-item-action="lock-open">Abrir maleta</button>',
    radio:'<button class="object-action" data-item-action="radio-tune">Sintonizar</button>',
    crystal:'<button class="object-action" data-item-action="crystal-open">Observar visão</button>',
    tarot:'<button class="object-action" data-item-action="tarot-draw">Fazer tiragem</button>',
    scale:'<button class="object-action" data-item-action="scale-test">Pesar coração</button>',
    ouija:'<button class="object-action" data-item-action="ouija-open">Consultar</button>',
    musicbox:'<button class="object-action" data-item-action="music-toggle">'+(st==="on"?"Parar melodia":"Girar manivela")+'</button>',
    pendulum:'<button class="object-action" data-item-action="pendulum-toggle">'+(st==="on"?"Parar":"Iniciar")+'</button>',
    emf:'<button class="object-action" data-item-action="emf-toggle">Medir campo</button>',
    thermometer:'<button class="object-action" data-item-action="thermometer-read">Ler temperatura</button>',
    candle:'<button class="object-action" data-item-action="candle-toggle">'+(st==="on"?"Apagar":"Acender")+'</button>',
    incense:'<button class="object-action" data-item-action="incense-toggle">'+(st==="on"?"Apagar incenso":"Acender incenso")+'</button>',
    cauldron:'<button class="object-action" data-item-action="cauldron-stir">Mexer caldeirão</button>',
    skull:'<button class="object-action" data-item-action="skull-speak">Ouvir crânio</button>',
    mirror:'<button class="object-action" data-item-action="mirror-toggle">Olhar no espelho</button>',
    vampireMirror:'<button class="object-action" data-item-action="mirror-toggle">Ver reflexo</button>',
    holyWater:'<button class="object-action" data-item-action="holy-water">Examinar frasco</button>',
    pocketWatch:'<button class="object-action" data-item-action="watch-toggle">Dar corda</button>',
    hourglass:'<button class="object-action" data-item-action="timer-toggle">Virar ampulheta</button>',
    kitchenTimer:'<button class="object-action" data-item-action="timer-toggle">Ajustar timer</button>',
    vhs:'<button class="object-action" data-item-action="vhs-toggle">'+(st==="on"?"Parar fita":"Reproduzir fita")+'</button>',
    tv:'<button class="object-action" data-item-action="tv-toggle">Ligar televisor</button>',
    portal:'<button class="object-action" data-item-action="portal-toggle">'+(st==="on"?"Fechar portal":"Abrir portal")+'</button>',
    mask:'<button class="object-action" data-item-action="mask-toggle">Vestir máscara</button>',
    wisp:'<button class="object-action" data-item-action="wisp-toggle">Invocar luz</button>',
    cat:'<button class="object-action" data-item-action="cat-toggle">Observar os olhos</button>',
    brickWall:'<button class="object-action" data-item-action="wall-search">Examinar parede</button>',
    pouch:'<button class="object-action" data-item-action="pouch-open">Cheirar saquinho</button>',
    mirrorBlack:'<button class="object-action" data-item-action="mirror-toggle">Atravessar o olhar</button>',
    switch:'<button class="object-action" data-item-action="switch-toggle">'+(st==="on"?"Desligar":"Ligar")+'</button>',
    dial:'<button class="object-action" data-item-action="dial-turn">Girar disco</button>',
    slider:'<input class="object-slider" data-object-slider="position" type="range" min="0" max="100" value="'+Number(node.props.position||50)+'">',
    bulb:'<button class="object-action" data-item-action="bulb-toggle">'+(st==="on"?"Apagar lâmpada":"Acender lâmpada")+'</button>',
    key:'<button class="object-action" data-item-action="key-use">Examinar chave</button>',
    coin:'<button class="object-action" data-item-action="coin-flip">Virar moeda</button>',
    trigger:'<button class="object-action gm-only-control" data-item-action="trigger-toggle">'+(node.props.activated?"Desativar gatilho":"Ativar gatilho")+'</button>',
    tree:'<button class="object-action" data-item-action="tree-state">Alterar estado</button>'
  };
  let art=info.icon,sub=info.desc,screen="";
  if (type==="crystal") art='<div class="object-orb"></div>';
  if (type==="candle" || type==="incense") art='<div class="object-flame" style="'+(st==="on"?"":"opacity:.25")+'"></div>';
  if (type==="radio" || type==="emf" || type==="vhs" || type==="tv") {
    screen='<div class="object-screen">'+esc(node.props.display || (st==="on"?"SINAL ATIVO":"SEM SINAL"))+'</div>';
  }
  if (type==="portal") art='<div class="object-orb"></div>';
  if (type==="scale") art='<div class="object-beam" style="--beam:'+Number(node.props.beam||0)+'deg"></div>';
  if (type==="ouija") art='<div class="object-planchette"></div>';
  if (type==="cat") art='<div class="object-art">🐈‍⬛<span style="color:#b4f58c;text-shadow:0 0 12px #b4f58c">● ●</span></div>';
  if (type==="pendulum") art='<div class="object-art" style="animation:'+(st==="on"?"wisp 1.5s infinite":"none")+'">🔻</div>';
  if (type==="tree") sub="Estado: "+({locked:"Bloqueado",available:"Disponível",solved:"Resolvido"}[node.props.treeState||"available"]);
  if (type==="safe" || type==="lockbox") screen='<div class="object-screen">'+(node.props.unlocked?"ABERTO":"TRANCADO")+'</div>';
  const action=buttons[type] || '<button class="object-action" data-item-action="generic">Interagir</button>';
  return '<div class="object-visual '+(type==="portal"?"object-portal":"")+'">'+art+screen+'<div class="object-sub">'+esc(info.name)+'</div><div class="object-state">'+esc(node.props.message || sub)+'</div>'+action+'</div>';
}
function renderNode(node) {
  const style="left:"+node.x+"px;top:"+node.y+"px;width:"+node.w+"px;height:"+node.h+"px;z-index:"+node.z+";transform:rotate("+node.rotation+"deg) scaleX("+(node.flipX?-1:1)+") scaleY("+(node.flipY?-1:1)+")";
  const controls='<span class="item-controls"><button data-item-action="flip" title="Virar frente/verso">↻</button><button data-item-action="duplicate" title="Duplicar">⧉</button><button data-item-action="delete" title="Excluir">×</button></span>';
  const header='<div class="item-head"><span class="item-title">'+esc(node.title)+'</span><span class="item-kind">'+esc(node.label || node.type)+'</span>'+controls+'</div>';
  let content="";
  if (node.type==="image" || node.type==="map") {
    content='<div class="image-body"><img src="'+esc(safeSrc(node.src))+'" alt="'+esc(node.title)+'">'+(node.caption?'<div class="image-caption">'+esc(node.caption)+'</div>':'')+(node.type==="map"?'<canvas class="fog-canvas" data-fog-canvas="'+esc(node.id)+'"></canvas>':'')+'</div>';
  } else if (node.type==="document" || node.type==="pdf" || node.type==="leaf") {
    const body = node.face==="back" ? (node.backBody || "Verso sem anotações.") : (node.body || "");
    content='<div class="item-body">'+(node.type==="document"?'<div class="paper-header">'+esc(node.title)+'</div>':'')+esc(body)+(node.uvSecret?'<div class="uv-secret secret-text">'+esc(node.uvText || "Uma mensagem aparece sob luz negra.")+'</div>':'')+'</div>';
  } else if (node.type==="note") {
    content='<div class="item-body" contenteditable="false">'+esc(node.body || "")+'</div>';
  } else if (node.type==="book") {
    const pages=node.props.pages || [];
    const page=pages[clamp(Number(node.props.page||0),0,Math.max(0,pages.length-1))] || {title:"Página",body:""};
    content='<div class="item-body notebook-lines"><div style="font:700 10px var(--ui);letter-spacing:.15em;margin-bottom:8px">'+esc(page.title || "Página")+'</div>'+esc((page.body||"").slice(0,250))+'<div class="panel-actions"><button class="object-action" data-item-action="book-open">Abrir caderno</button></div></div>';
  } else if (node.type==="audio") {
    content='<div class="item-body"><audio controls preload="metadata" style="width:100%" src="'+esc(safeSrc(node.src))+'"></audio><p>'+esc(node.body || "Gravação anexada ao caso.")+'</p></div>';
  } else if (node.type==="pdf") {
    content='<div class="item-body">▤ Documento PDF<br><a href="'+esc(safeSrc(node.src))+'" target="_blank" rel="noopener">Abrir documento ↗</a></div>';
  } else if (node.type==="tape") {
    content='<div class="tape-strip">'+esc(node.body || "FITA · EVIDÊNCIA")+'</div>';
  } else if (node.type==="scratch") {
    content='<div class="item-body">'+esc(node.body || "Mensagem escondida")+'<div class="scratch-progress"><span style="width:'+Number(node.props.progress||0)+'%"></span></div><div class="scratch-cover '+(node.props.revealed?"revealed":"")+'">RASPE AQUI</div></div>';
  } else if (node.type==="object") {
    content=objectInside(node);
  }
  const pinHtml=(node.pins||[]).map((pin)=>'<button class="pin-dot" data-pin-node="'+esc(node.id)+'" data-pin-id="'+esc(pin.id)+'" title="'+esc(pin.label||"Pin")+'" style="left:'+pin.x+'px;top:'+pin.y+'px"><span class="pin-label">'+esc(pin.label||"Pista")+'</span></button>').join("");
  const footer='<div class="item-footer"><span>'+esc(node.filename || "SAI · EVIDÊNCIA")+'</span><span>'+esc(node.type.toUpperCase())+'</span></div>';
  const handles=selectedIds.includes(node.id) && canEdit ? '<span class="item-handle resize" data-handle="resize"></span><span class="item-handle rotate" data-handle="rotate"></span>' : "";
  return '<article class="'+itemClasses(node)+'" data-item="'+esc(node.id)+'" style="'+style+'"><div class="item-shell">'+header+content+footer+handles+pinHtml+(node.gmOnly?'<span class="tree-badge">M</span>':'')+'</div></article>';
}
function itemClasses(node) {
  const c=["item"];
  if (selectedIds.includes(node.id)) c.push("selected");
  if (node.type==="document" || node.type==="pdf" || node.type==="leaf") c.push("paper");
  if (node.type==="note") c.push(node.props.noteStyle==="ficha"?"note-ficha":node.props.noteStyle==="free"?"note-free":"note-postit");
  if (node.type==="image") c.push("image-node");
  if (node.type==="map") c.push("map-node");
  if (node.type==="object") {
    c.push("object-node");
    if (node.props.objectType==="vampireMirror" || node.props.objectType==="mirror") c.push("object-vampire");
    if (node.props.objectType==="tree") c.push("tree-"+(node.props.treeState||"locked"));
    if (node.props.objectType==="portal") c.push("object-portal");
  }
  if (node.uvSecret) c.push("uv-hidden");
  if (node.locked) c.push("locked");
  return c.join(" ");
}
function drawFog(node) {
  const canvas=itemLayer.querySelector('[data-fog-canvas="'+node.id+'"]');
  if (!canvas) return;
  const w=Math.max(1,Math.round(node.w)),h=Math.max(1,Math.round(node.h));
  canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext("2d");
  ctx.fillStyle="rgba(4,4,8,.86)";ctx.fillRect(0,0,w,h);
  (node.props.fogStrokes || []).forEach((stroke)=>{
    ctx.globalCompositeOperation=stroke.mode==="reveal"?"destination-out":"source-over";
    ctx.strokeStyle="rgba(0,0,0,.95)";ctx.fillStyle="rgba(0,0,0,.95)";
    ctx.lineWidth=stroke.radius*2;ctx.lineCap="round";ctx.lineJoin="round";
    if (!stroke.points || !stroke.points.length) return;
    ctx.beginPath();ctx.moveTo(stroke.points[0].x,stroke.points[0].y);
    stroke.points.forEach((p)=>ctx.lineTo(p.x,p.y));
    ctx.stroke();
    stroke.points.forEach((p)=>{ctx.beginPath();ctx.arc(p.x,p.y,stroke.radius,0,Math.PI*2);ctx.fill();});
  });
  ctx.globalCompositeOperation="source-over";
}
function renderItems() {
  const nodes=boardState.nodes.filter((node)=>isGM || !node.gmOnly);
  itemLayer.innerHTML=nodes.map(renderNode).join("");
  nodes.forEach((node)=>{if(node.type==="map")drawFog(node);});
  renderWires();
}
function renderMarks() {
  const html=[];
  boardState.marks.forEach((mark)=>{
    if (mark.points && mark.points.length) {
      const d=mark.points.map((p,i)=>(i?"L ":"M ")+p.x+" "+p.y).join(" ");
      let shape=d;
      if (mark.kind==="line") shape="M "+mark.x1+" "+mark.y1+" L "+mark.x2+" "+mark.y2;
      if (mark.kind==="arrow") shape="M "+mark.x1+" "+mark.y1+" L "+mark.x2+" "+mark.y2;
      if (mark.kind==="circle") {
        const rx=Math.abs(mark.x2-mark.x1)/2,ry=Math.abs(mark.y2-mark.y1)/2;
        html.push('<ellipse class="mark-shape" cx="'+((mark.x1+mark.x2)/2)+'" cy="'+((mark.y1+mark.y2)/2)+'" rx="'+rx+'" ry="'+ry+'"></ellipse>');
        return;
      }
      if (mark.kind==="box") {
        html.push('<rect class="mark-shape" x="'+Math.min(mark.x1,mark.x2)+'" y="'+Math.min(mark.y1,mark.y2)+'" width="'+Math.abs(mark.x2-mark.x1)+'" height="'+Math.abs(mark.y2-mark.y1)+'"></rect>');
        return;
      }
      html.push('<path class="mark-shape" d="'+shape+'" '+(mark.kind==="arrow"?'marker-end="url(#arrowhead)"':'')+'></path>');
    }
  });
  markLayer.innerHTML='<svg style="position:absolute;inset:0;width:5000px;height:4000px;overflow:visible" xmlns="http://www.w3.org/2000/svg"><defs><marker id="arrowhead" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto"><path d="M0 0 L0 6 L8 3 z" fill="#c32126"></path></marker></defs>'+html.join("")+'</svg>';
}
function pinWorld(nodeId,pinId) {
  const node=getNode(nodeId),pin=node && (node.pins||[]).find((p)=>p.id===pinId);
  return node&&pin?{x:node.x+pin.x+8,y:node.y+pin.y+8}:null;
}
function renderMinimap() {
  if (!minimapVisible) return;
  const mini=$("mini-map");
  if (!mini) return;
  const nodes=boardState.nodes.filter((n)=>isGM || !n.gmOnly);
  const marks=nodes.map((n)=>{
    const left=clamp(n.x/5000*100,0,99),top=clamp(n.y/4000*100,0,99);
    const type=n.type==="object"?"object":n.type==="note"?"note":n.type==="map"?"map":"";
    return '<i class="mini-node '+type+'" style="left:'+left+'%;top:'+top+'%"></i>';
  }).join("");
  const w=clamp(viewport.clientWidth/zoom/5000*100,5,100),h=clamp(viewport.clientHeight/zoom/4000*100,5,100);
  const x=clamp(-tx/zoom/5000*100,0,100-w),y=clamp(-ty/zoom/4000*100,0,100-h);
  mini.innerHTML=marks+'<i class="mini-view" style="left:'+x+'%;top:'+y+'%;width:'+w+'%;height:'+h+'%"></i>';
}
function renderHeader() {
  $("case-name").textContent=boardState.name;
  $("case-status").textContent=boardState.status;
  const visible=boardState.nodes.filter((n)=>isGM || !n.gmOnly).length;
  $("item-count").textContent=visible+" evidência(s)";
  $("wire-count").textContent=boardState.wires.length+" conexão(ões)";
  $("role-label").textContent=roleName;
  $("surface-select").value=boardState.surface||"default";
  viewport.className="viewport surface-"+(boardState.surface||"default");
  document.body.classList.toggle("uv-on",!!boardState.settings.uv);
  document.body.classList.toggle("lamp-on",!!boardState.settings.lamp);
  document.body.classList.toggle("torch-on",!!boardState.settings.torch);
  Object.entries(boardState.settings.effects).forEach(([key,value])=>document.body.classList.toggle("fx-"+key,!!value));
  document.body.classList.toggle("sanity-on",!!boardState.settings.sanity.enabled);
  $("uv-toggle").checked=!!boardState.settings.uv;
  $("lamp-toggle").checked=!!boardState.settings.lamp;
  $("torch-toggle").checked=!!boardState.settings.torch;
  $("sanity-value").textContent=boardState.settings.sanity.value;
  $("sanity-fill").style.height=boardState.settings.sanity.value+"%";
  $("minimap").hidden=!minimapVisible;
}
function renderAll() {
  if (!boardState) return;
  updateTransform();
  renderItems();
  renderMarks();
  renderHeader();
  renderInspector();
  renderMinimap();
  updateLight();
}
function updateLight() {
  const light=boardState.settings.light;
  $("light-overlay").style.background="radial-gradient(ellipse at "+(light.direction==="l"?"25% 22%":light.direction==="r"?"75% 22%":"50% 18%")+", "+light.color+"88 0, transparent 54%)";
  $("light-overlay").style.opacity=String(light.intensity/100);
  viewport.style.setProperty("--uv-radius",light.radius+"px");
  viewport.style.setProperty("--mx",torchPoint.x+"%");
  viewport.style.setProperty("--my",torchPoint.y+"%");
  $("dark-overlay").style.background="radial-gradient(circle "+light.radius+"px at "+torchPoint.x+"% "+torchPoint.y+"%, transparent 0, rgba(0,0,0,.75) 100%)";
  $("dark-overlay").style.opacity=boardState.settings.torch?"1":boardState.settings.lamp?".45":"0";
}
function syncSelectionClass() {
  itemLayer.querySelectorAll(".item").forEach((el)=>el.classList.toggle("selected",selectedIds.includes(el.dataset.item)));
  renderWires();renderInspector();
}
function selectNode(id,add=false) {
  if (add) {
    selectedIds=selectedIds.includes(id)?selectedIds.filter((x)=>x!==id):selectedIds.concat(id);
  } else selectedIds=[id];
  syncSelectionClass();
}
function field(label,html) { return '<div class="field"><label>'+label+'</label>'+html+'</div>'; }
function renderProperties() {
  const nodes=getSelected();
  inspectorTitle.textContent=nodes.length===1?"Detalhes da evidência":nodes.length>1?"Seleção múltipla":"Central de investigação";
  if (!nodes.length) {
    inspectorContent.innerHTML='<h2>Central de investigação</h2><div class="empty-state">Selecione uma evidência para editar suas propriedades.<br><br>Use a biblioteca de objetos para adicionar equipamentos, enigmas e elementos sobrenaturais.</div><h3>Resumo do caso</h3><div class="info-card"><strong>'+boardState.nodes.length+' itens · '+boardState.wires.length+' fios</strong><small>Quadro '+esc(boardState.name)+'<br>Última alteração: '+new Date(boardState.updatedAt||Date.now()).toLocaleString("pt-BR")+'</small></div><div class="panel-actions"><button class="btn primary" data-do="new-note">Criar nota</button><button class="btn" data-do="new-document">Criar documento</button><button class="btn" data-do="new-object">Adicionar objeto</button></div>';
    return;
  }
  if (nodes.length>1) {
    inspectorContent.innerHTML='<h2>'+nodes.length+' evidências selecionadas</h2>'+field("Escala / tamanho",'<input id="multi-width" type="number" min="60" max="1200" placeholder="Largura comum">')+field("Rotação em graus",'<input id="multi-rotation" type="number" value="0">')+'<div class="panel-actions"><button class="btn" data-do="multi-lock">Alternar bloqueio</button><button class="btn danger" data-do="delete">Excluir selecionados</button></div>';
    return;
  }
  const node=nodes[0];
  let html='<h2>'+esc(node.title)+'</h2>';
  html+=field("Título",'<input data-edit="title" value="'+esc(node.title)+'">');
  html+=field("Identificação / etiqueta",'<input data-edit="label" value="'+esc(node.label||"EVIDÊNCIA")+'">');
  if (["document","note","leaf","book"].includes(node.type)) html+=field("Anotações / transcrição",'<textarea data-edit="body">'+esc(node.body||"")+'</textarea>');
  if (node.type==="note") html+=field("Papel da nota",'<select data-edit-prop="noteStyle"><option value="postit">Post-it amarelo</option><option value="ficha">Ficha pautada</option><option value="free">Papel livre</option></select>');
  if (node.type==="image" || node.type==="map") {
    html+=field("Legenda",'<input data-edit="caption" value="'+esc(node.caption||"")+'">');
    html+=field("Endereço da imagem",'<input data-edit="src" value="'+esc(node.src||"")+'" placeholder="https://...">');
  }
  if (node.type==="document" || node.type==="leaf") {
    html+=field("Verso do documento",'<textarea data-edit="backBody">'+esc(node.backBody||"")+'</textarea>');
    html+='<div class="panel-actions"><button class="btn" data-do="flip">Virar frente/verso</button></div>';
  }
  if (node.type==="book") {
    const pages=node.props.pages||[];
    html+='<h3>Caderno · '+pages.length+' página(s)</h3><div class="panel-actions"><button class="btn" data-do="book-open">Abrir editor</button><button class="btn" data-do="book-add-page">Nova página</button><button class="btn" data-do="book-tear">Arrancar folha</button></div>';
  }
  if (node.type==="object") {
    const type=node.props.objectType,info=objectInfo(type);
    html+='<div class="info-card"><strong>'+esc(info.name)+'</strong><small>'+esc(info.desc)+'</small></div>';
    html+=field("Estado",'<input data-edit-prop="message" value="'+esc(node.props.message||"")+'" placeholder="Mensagem / observação">');
    if (["safe","lockbox","radio","crystal","skull"].includes(type) && isGM) {
      const sec=secretFor(node.id);
      const value=type==="safe"?sec.code||"":type==="lockbox"?sec.password||"":type==="radio"?sec.frequency||"":sec.vision||"";
      html+=field(type==="safe"?"Combinação secreta":type==="lockbox"?"Senha da maleta":type==="radio"?"Frequência correta":type==="crystal"?"Visão escondida":"Mensagem do crânio",'<input id="secret-setting" type="text" value="'+esc(value)+'">');
      html+='<div class="panel-actions"><button class="btn" data-do="save-secret">Salvar segredo do mestre</button></div>';
    }
    if (type==="tree") html+=field("Estado da pista",'<select data-edit-prop="treeState"><option value="locked">Bloqueado</option><option value="available">Disponível</option><option value="solved">Resolvido</option></select>');
    html+='<div class="panel-actions"><button class="btn primary" data-do="interact">Interagir</button></div>';
  }
  if (node.type==="scratch") html+=field("Mensagem sob a raspadinha",'<textarea data-edit="body">'+esc(node.body||"")+'</textarea>');
  if (node.type==="audio" || node.type==="pdf") html+=field("URL externa",'<input data-edit="src" value="'+esc(node.src||"")+'" placeholder="https://...">');
  html+='<h3>Transformação</h3><div class="row-fields">'+field("Largura",'<input data-edit-num="w" type="number" min="60" max="1200" value="'+node.w+'">')+field("Altura",'<input data-edit-num="h" type="number" min="45" max="900" value="'+node.h+'">')+'</div>';
  html+=field("Rotação",'<input data-edit-num="rotation" type="number" min="-360" max="360" value="'+node.rotation+'">');
  html+='<h3>Camadas e visibilidade</h3><div class="field"><label><input type="checkbox" data-edit-check="locked" '+(node.locked?"checked":"")+'> Bloquear movimentação</label></div>';
  if (isGM) {
    html+='<div class="field"><label><input type="checkbox" data-edit-check="gmOnly" '+(node.gmOnly?"checked":"")+'> Visível apenas para o mestre</label></div>';
    html+='<div class="field"><label><input type="checkbox" data-edit-check="uvSecret" '+(node.uvSecret?"checked":"")+'> Revelar texto somente com luz negra</label></div>';
    if (node.uvSecret) html+=field("Texto oculto UV",'<textarea data-edit="uvText">'+esc(node.uvText||"")+'</textarea>');
    if (node.type==="trigger") html+='<div class="field"><label><input type="checkbox" data-edit-prop-check="activated" '+(node.props.activated?"checked":"")+'> Ativador ligado</label></div>';
  }
  html+='<h3>Ações da evidência</h3><div class="panel-actions"><button class="btn" data-do="add-pin">＋ Pin</button><button class="btn" data-do="duplicate">Duplicar</button><button class="btn" data-do="front">Trazer à frente</button><button class="btn" data-do="back">Enviar para trás</button><button class="btn" data-do="export-png">Exportar PNG</button><button class="btn danger" data-do="delete">Excluir</button></div>';
  inspectorContent.innerHTML=html;
  const styleSelect=inspectorContent.querySelector('[data-edit-prop="noteStyle"]');if(styleSelect)styleSelect.value=node.props.noteStyle||"postit";
  const treeSelect=inspectorContent.querySelector('[data-edit-prop="treeState"]');if(treeSelect)treeSelect.value=node.props.treeState||"available";
}
function renderCatalog() {
  inspectorTitle.textContent="Biblioteca de objetos";
  const groups=[...new Set(catalog.map((item)=>item.category))];
  let html='<h2>Objetos e mecanismos</h2><p>Adicione elementos interativos, equipamentos, enigmas e itens de cenário ao quadro.</p><input class="catalog-search" id="catalog-search" placeholder="Buscar objeto..."><div id="catalog-list">';
  groups.forEach((group)=>{
    html+='<h3>'+esc(group)+'</h3><div class="catalog-grid">';
    catalog.filter((item)=>item.category===group).forEach((item)=>{
      html+='<button class="catalog-card" data-catalog="'+esc(item.type)+'"><span class="art">'+item.icon+'</span><span><b>'+esc(item.name)+'</b><small>'+esc(item.desc)+'</small></span></button>';
    });
    html+='</div>';
  });
  html+='</div><div class="panel-actions"><button class="btn" data-do="new-document">＋ Documento</button><button class="btn" data-do="new-note">＋ Nota</button><button class="btn" data-do="new-map">＋ Mapa</button></div>';
  inspectorContent.innerHTML=html;
  const search=$("catalog-search");
  if(search)search.addEventListener("input",()=>{
    const q=search.value.toLowerCase();
    inspectorContent.querySelectorAll(".catalog-card").forEach((card)=>card.style.display=card.textContent.toLowerCase().includes(q)?"flex":"none");
    inspectorContent.querySelectorAll("h3").forEach((heading)=>{
      const grid=heading.nextElementSibling;
      heading.style.display=grid && Array.from(grid.querySelectorAll(".catalog-card")).some((b)=>b.style.display!=="none")?"block":"none";
      if(grid)grid.style.display=Array.from(grid.querySelectorAll(".catalog-card")).some((b)=>b.style.display!=="none")?"grid":"none";
    });
  });
}
function renderEffectsPanel() {
  inspectorTitle.textContent="Atmosfera e efeitos";
  const fx=boardState.settings.effects,light=boardState.settings.light,audio=boardState.settings.audio;
  const fxRows=[["fog","Névoa rasteira","Movimento lento sobre a parte inferior da mesa."],["ash","Cinzas e partículas","Partículas discretas cruzam o quadro."],["web","Teia de aranha","Decoração no canto superior."],["blood","Lua de Sangue","Filtro vermelho e lua no horizonte."],["wisp","Fogo-fátuo","Luz espectral flutuante."],["mask","Máscara / vinheta","Escurece as bordas da visão."],["bats","Morcegos","Silhuetas atravessam a tela."],["eyes","Olhos no escuro","Pontos luminosos aparecem na escuridão."],["rain","Chuva","Gotas e riscos de chuva."],["snow","Neve","Flocos atravessam a mesa."],["embers","Brasas","Partículas incandescentes."],["ectoplasm","Ectoplasma","Brilho sobrenatural em pontos."],["smoke","Fumaça de incenso","Fumaça saindo dos objetos acesos."]];
  let html='<h2>Atmosfera da investigação</h2><h3>Iluminação de campo</h3>';
  html+=field("Modo de iluminação",'<select id="light-mode"><option value="none">Luz ambiente</option><option value="room">Escurecer a sala</option><option value="lamp">Luminária</option><option value="torch">Lanterna de mão</option><option value="uv">Luz negra</option></select>');
  html+='<div class="row-fields">'+field("Cor da luz",'<input type="color" id="light-color" value="'+light.color+'">')+field("Intensidade",'<input type="range" id="light-intensity" min="0" max="100" value="'+light.intensity+'">')+'</div>';
  html+=field("Tamanho da lanterna / UV",'<input type="range" id="light-radius" min="80" max="600" value="'+light.radius+'">');
  html+='<div class="panel-actions"><button class="btn" data-do="toggle-uv">Luz negra</button><button class="btn" data-do="toggle-lamp">Luminária</button><button class="btn" data-do="toggle-torch">Lanterna</button></div>';
  html+='<h3>Efeitos de tela</h3><div class="field"><label>Ative os efeitos da cena</label>';
  fxRows.forEach((item)=>{html+='<label style="display:flex;align-items:center;gap:8px;margin:6px 0;color:#d5c09a;font-size:11px"><input type="checkbox" data-fx="'+item[0]+'" '+(fx[item[0]]?"checked":"")+'> <span>'+esc(item[1])+' <small style="display:block;color:#9f8a6c">'+esc(item[2])+'</small></span></label>';});
  html+='</div><h3>Sanidade</h3><div class="field"><label><input type="checkbox" id="sanity-enabled" '+(boardState.settings.sanity.enabled?"checked":"")+'> Exibir marcador de sanidade</label></div>'+field("Valor atual",'<input type="range" id="sanity-range" min="0" max="100" value="'+boardState.settings.sanity.value+'">');
  html+='<h3>Áudio e volume</h3><div class="field"><label><input type="checkbox" id="audio-mute" '+(audio.muted?"checked":"")+'> Mudo</label></div>';
  [["general","Geral"],["items","Itens"],["effects","Efeitos"],["voices","Vozes e áudios"]].forEach((pair)=>{html+=field(pair[1],'<input type="range" data-volume="'+pair[0]+'" min="0" max="100" value="'+audio[pair[0]]+'">');});
  html+=field("Ambiente",'<select id="ambience-select"><option value="none">Silêncio</option><option value="wind">Vento distante</option><option value="static">Estática de rádio</option><option value="drone">Zumbido subterrâneo</option></select>')+'<div class="panel-actions"><button class="btn" data-do="ambient-start">Iniciar ambiente</button><button class="btn" data-do="ambient-stop">Parar ambiente</button></div>';
  inspectorContent.innerHTML=html;
  $("light-mode").value=light.mode;
  $("ambience-select").value=audio.ambience;
}
function renderBoardsPanel() {
  inspectorTitle.textContent="Quadros e arquivos";
  let html='<h2>Mesas de investigação</h2><p>Crie quadros diferentes para separar casos, locais e capítulos. Cada cena do Owlbear também recebe seu próprio salvamento compartilhado.</p><div class="panel-actions"><button class="btn primary" data-do="new-board">＋ Novo quadro</button><button class="btn" data-do="rename-board">Renomear</button></div>';
  workspace.boards.forEach((entry)=>{
    html+='<button class="list-card" data-board-id="'+esc(entry.id)+'"><span class="art">'+(entry.id===workspace.activeId?"◉":"▣")+'</span><span><b>'+esc(entry.name)+'</b><small>'+(entry.id===workspace.activeId?"Quadro aberto · ":"")+((entry.data.nodes||[]).length)+" evidências · "+((entry.data.wires||[]).length)+" fios</small></span></button>";
  });
  html+='<h3>Arquivo do caso</h3><div class="panel-actions"><button class="btn" data-do="export-json">Exportar JSON</button><button class="btn" data-do="import-json">Importar JSON</button><button class="btn" data-do="export-board-png">Exportar imagem</button></div><div class="panel-actions"><button class="btn danger" data-do="clear-board">Limpar quadro atual</button></div>';
  inspectorContent.innerHTML=html;
}
function renderSharePanel() {
  inspectorTitle.textContent="Jogar junto";
  let html='<h2>Colaboração da mesa</h2>';
  const state=isOwlbear?(sceneReady?"Cena aberta e pronta para sincronizar":"Aguardando uma cena do Owlbear"):"Executando fora do Owlbear";
  html+='<div class="sync-card"><strong>'+esc(state)+'</strong><small>'+(isOwlbear?(sceneReady?"O mestre grava o quadro nos metadados da cena. Todos os jogadores que usam a mesma cena recebem as alterações.":"Abra uma cena para carregar ou sincronizar o dossiê."):"O salvamento está neste dispositivo. Abra a extensão dentro de uma sala do Owlbear para compartilhar a mesa.")+'</small></div>';
  html+='<div class="fx-status"><span style="background:'+(isGM?'#8db56e':'#d3ad5b')+'"></span>'+(isGM?"Permissão de mestre":"Visualização de jogador")+'</div>';
  html+='<h3>Código de compartilhamento</h3><p>O código transporta o quadro como backup. Para jogar em conjunto em tempo real, todos devem abrir a mesma sala e cena do Owlbear.</p><div class="panel-actions"><button class="btn primary" data-do="share-code">Gerar código</button><button class="btn" data-do="import-code">Colar código</button></div>';
  html+='<h3>Arquivos de mestre</h3><p>Senhas, combinações e evidências marcadas como exclusivas do mestre são mantidas no armazenamento local do mestre e não são enviadas como texto aberto aos jogadores.</p>';
  html+='<div class="panel-actions"><button class="btn" data-do="export-gm">Exportar backup de mestre</button><button class="btn" data-do="import-gm">Importar backup de mestre</button></div>';
  inspectorContent.innerHTML=html;
}
function renderInspector() {
  if (currentPanel==="catalog") return renderCatalog();
  if (currentPanel==="effects") return renderEffectsPanel();
  if (currentPanel==="boards") return renderBoardsPanel();
  if (currentPanel==="share") return renderSharePanel();
  return renderProperties();
}
function setPanel(panel) {
  currentPanel=panel;
  document.querySelectorAll("[data-panel]").forEach((button)=>button.classList.toggle("active",button.dataset.panel===panel));
  renderInspector();
}
function renderAll() {
  renderItems();
  renderMarks();
  renderHeader();
  renderInspector();
  renderMinimap();
  updateTransform();
  updateLight();
  renderEffects();
}


function openModal(title,body,buttons=[]) {
  $("modal-title").textContent=title;
  $("modal-body").innerHTML=body;
  $("modal-footer").innerHTML=buttons.map((b,i)=>'<button class="btn '+(b.primary?"primary":"")+'" data-modal-action="'+i+'">'+esc(b.label)+'</button>').join("");
  $("modal-backdrop").classList.add("show");
  $("modal-footer").onclick=(e)=>{
    const btn=e.target.closest("[data-modal-action]");
    if(!btn)return;
    const index=Number(btn.dataset.modalAction);
    const action=buttons[index]&&buttons[index].action;
    if(action)action();
  };
}
function closeModal(){$("modal-backdrop").classList.remove("show");}
function hashText(value) {
  const text=String(value).trim().toUpperCase();
  if (crypto && crypto.subtle && window.TextEncoder) {
    return crypto.subtle.digest("SHA-256",new TextEncoder().encode(text)).then((buf)=>Array.from(new Uint8Array(buf)).map((b)=>b.toString(16).padStart(2,"0")).join(""));
  }
  let h=2166136261;
  for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}
  return "fnv-"+(h>>>0).toString(16);
}
async function verifySecret(node,key,input) {
  const sec=secretFor(node.id);
  const actual=sec[key];
  const hashKey=key==="code"?"codeHash":key==="password"?"passwordHash":"frequencyHash";
  if (actual) return String(actual).trim().toUpperCase()===String(input).trim().toUpperCase();
  const expected=node.props[hashKey];
  if (!expected) return false;
  return (await hashText(input))===expected;
}
async function setSecret(node,key,value) {
  secretFor(node.id)[key]=String(value);
  persistPrivate();
  const hashKey=key==="code"?"codeHash":key==="password"?"passwordHash":"frequencyHash";
  node.props[hashKey]=await hashText(value);
  scheduleSave();
}
function installObjectSecrets(node) {
  if (node.type!=="object") return;
  const type=node.props.objectType;
  const sec=secretFor(node.id);
  let key="",value="";
  if(type==="safe"){key="code";value=randomCode(3);}
  if(type==="lockbox"){key="password";value="EVIDENCIA";}
  if(type==="radio"){key="frequency";value="147.30";}
  if(type==="crystal"){key="vision";value="Uma silhueta observa do outro lado da janela.";}
  if(type==="skull"){key="message";value="O que foi enterrado ainda se lembra de vocês.";}
  if(key && !sec[key]) {
    sec[key]=value;
    const hashKey=key==="code"?"codeHash":key==="password"?"passwordHash":"frequencyHash";
    hashText(value).then((hash)=>{node.props[hashKey]=hash;persistPrivate();scheduleSave();});
    persistPrivate();
  }
}
const oldAddObject=addObject;
addObject=function(type) {
  const node=oldAddObject(type);
  installObjectSecrets(node);
  scheduleSave();
  return node;
};
function showSafePuzzle(node) {
  const digits=String(secretFor(node.id).code || "000").split("");
  openModal("Cofre de combinação",
    '<p>Gire os três discos e tente encontrar a combinação correta.</p><div style="display:flex;gap:10px;justify-content:center;margin:16px 0">'+digits.map((d,i)=>'<label style="display:grid;gap:6px;text-align:center;color:#d7bd8b;font:700 10px var(--ui)">DISCO '+(i+1)+'<input class="safe-digit" data-digit="'+i+'" inputmode="numeric" maxlength="1" value="0" style="width:58px;text-align:center;font:700 30px ui-monospace;background:#120c08;color:#f4dba3;border:2px solid #80613b;padding:8px"></label>').join("")+'</div><div class="help">A combinação é configurada pelo mestre no painel de propriedades.</div>',
    [{label:"Cancelar",action:closeModal},{label:"Destrancar",primary:true,action:async()=>{
      const value=Array.from(document.querySelectorAll(".safe-digit")).map((el)=>el.value.replace(/\D/g,"").slice(-1)||"0").join("");
      if(!isGM && isOwlbear){sendMasterRequest("safe-unlock",node.id,{value:value});closeModal();toast("Tentativa enviada ao mestre.");return;}
      if(await verifySecret(node,"code",value)){remember();node.props.unlocked=true;node.props.objectState="open";node.props.message="O mecanismo cedeu. O cofre está aberto.";closeModal();renderAll();scheduleSave();toast("Cofre destrancado.");}
      else toast("Combinação incorreta. O mecanismo permanece travado.");
    }}]);
}
function showLockPuzzle(node) {
  openModal("Senha da maleta",'<p>Digite a senha para liberar as travas.</p><input id="lock-password" type="password" autocomplete="off" placeholder="Senha da maleta" style="font:700 18px var(--typewriter);letter-spacing:.14em;text-align:center">',[{label:"Cancelar",action:closeModal},{label:"Abrir maleta",primary:true,action:async()=>{
    const val=$("lock-password").value;
    if(!isGM && isOwlbear){sendMasterRequest("lockbox-unlock",node.id,{value:val});closeModal();toast("Senha enviada ao mestre.");return;}
    if(await verifySecret(node,"password",val)){remember();node.props.unlocked=true;node.props.message="A maleta foi aberta.";closeModal();renderAll();scheduleSave();toast("Maleta aberta.");}
    else toast("Senha incorreta.");
  }}]);
}
function showRadioPuzzle(node) {
  openModal("Sintonizar rádio",'<p>Gire o seletor até encontrar a frequência correta.</p><div class="radio-dial"><input id="radio-frequency" type="number" min="80" max="180" step=".01" value="100.00" style="font:700 25px ui-monospace;text-align:center"><span>MHz</span></div><p id="radio-feedback" class="help">O chiado aumenta quando você se aproxima do sinal.</p>',[
    {label:"Fechar",action:closeModal},
    {label:"Sintonizar",primary:true,action:async()=>{
      const val=Number($("radio-frequency").value).toFixed(2);
      if(!isGM && isOwlbear){sendMasterRequest("radio-tune",node.id,{value:val});closeModal();toast("Frequência enviada ao mestre.");return;}
      if(await verifySecret(node,"frequency",val)){remember();node.props.objectState="on";node.props.display="SINAL ENCONTRADO";node.props.message="Uma voz começa a falar entre os ruídos.";closeModal();renderAll();scheduleSave();toast("Sinal encontrado.");}
      else{$("radio-feedback").textContent="Apenas estática. Ajuste a frequência e tente novamente.";node.props.display="CHIADO";renderItems();}
    }}
  ]);
}
function showCrystal(node) {
  const sec=secretFor(node.id);
  const message=sec.vision || node.props.message || "A névoa se move, mas nada fica nítido.";
  if(isGM) {
    openModal("Bola de cristal",'<div class="object-orb" style="margin:14px auto;width:110px;height:110px"></div><p>'+esc(message)+'</p><p class="help">Visão configurável pelo mestre. O conteúdo secreto permanece local até ser revelado.</p>',[
      {label:"Fechar",action:closeModal},
      {label:"Revelar no quadro",primary:true,action:()=>{remember();node.props.message=message;node.props.visionRevealed=true;closeModal();renderAll();scheduleSave();}}
    ]);
  } else {
    openModal("Bola de cristal",'<p>'+(node.props.visionRevealed?esc(node.props.message):"A superfície turva não revela uma imagem clara.")+'</p>',[{label:"Fechar",primary:true,action:closeModal}]);
  }
}
const tarotCards=[
  ["A Torre","Ruptura, queda e revelação."],["A Lua","Ilusão, sonho e segredo."],["A Morte","Fim de um ciclo e transformação."],
  ["O Enforcado","Sacrifício, espera e nova perspectiva."],["O Diabo","Pacto, tentação e aprisionamento."],["A Sacerdotisa","Conhecimento oculto e intuição."],
  ["O Eremita","Isolamento e busca interior."],["A Justiça","Consequência, equilíbrio e julgamento."],["O Louco","Risco, começo e desconhecido."],
  ["A Estrela","Esperança e orientação."],["A Roda da Fortuna","Destino e mudança inevitável."],["O Sol","Exposição, verdade e clareza."]
];
function tarotDraw(node) {
  const draw=[...tarotCards].sort(()=>Math.random()-.5).slice(0,3);
  remember();
  node.props.tarotDraw=draw;
  node.props.message=draw.map((c,i)=>(i+1)+". "+c[0]).join(" · ");
  openModal("Tiragem de tarô",'<div class="catalog-grid">'+draw.map((c,i)=>'<div class="catalog-card" style="display:block;text-align:center;min-height:130px"><div style="font:34px var(--serif);color:#cda65d;margin:6px">'+["☽","☠","✶","♜","♢","☼"][i]+'</div><b>'+esc(c[0])+'</b><small>'+esc(c[1])+'</small></div>').join("")+'</div><p>Passado · Presente · Futuro</p>',[{label:"Guardar tiragem",primary:true,action:()=>{closeModal();renderAll();scheduleSave();}}]);
}
function showOuija(node) {
  const letters="ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  openModal("Tábua Ouija",'<p>Movimente a prancheta entre as letras e registre a resposta recebida.</p><div class="catalog-grid" style="grid-template-columns:repeat(6,1fr)">'+letters.split("").map((c)=>'<button class="btn" data-ouija-letter="'+c+'">'+c+'</button>').join("")+'<button class="btn" data-ouija-letter="SIM">SIM</button><button class="btn" data-ouija-letter="NÃO">NÃO</button><button class="btn" data-ouija-letter="ADEUS">ADEUS</button></div><div class="field" style="margin-top:12px"><label>Mensagem formada</label><input id="ouija-message" value="'+esc(node.props.message||"")+'"></div>',[
    {label:"Cancelar",action:closeModal},
    {label:"Registrar no objeto",primary:true,action:()=>{remember();node.props.message=$("ouija-message").value;node.props.objectState="on";closeModal();renderAll();scheduleSave();}}
  ]);
  $("modal-body").addEventListener("click",(e)=>{
    const letter=e.target.closest("[data-ouija-letter]");
    if(letter){$("ouija-message").value+=letter.dataset.ouijaLetter==="ADEUS"?" ":letter.dataset.ouijaLetter;}
  });
}
function showScale(node) {
  const outcome=Math.random();
  const balanced=outcome>.5;
  const message=balanced?"A pena e o coração estão em equilíbrio.":"O coração pesa mais que a pena.";
  remember();node.props.beam=balanced?0:outcome>.25?8:-8;node.props.message=message;node.props.objectState=balanced?"solved":"idle";
  renderAll();scheduleSave();toast(message);
}
function showTimer(node) {
  const seconds=Number(node.props.seconds||60);
  openModal("Temporizador",'<p>Defina a duração do mecanismo.</p><input id="timer-seconds" type="number" min="1" max="3600" value="'+seconds+'"><p id="timer-readout" class="help"></p>',[
    {label:"Cancelar",action:closeModal},
    {label:"Iniciar",primary:true,action:()=>{
      let left=clamp(Number($("timer-seconds").value)||60,1,3600);
      remember();node.props.seconds=left;node.props.objectState="on";closeModal();node.props.message="Contagem iniciada: "+left+"s";renderAll();scheduleSave();
      const started=Date.now(),timer=setInterval(()=>{
        const now=Date.now(),remaining=Math.max(0,left-Math.floor((now-started)/1000));
        node.props.display=String(remaining)+"s";
        const display=itemLayer.querySelector('[data-item="'+node.id+'"] .object-state');
        if(display)display.textContent="Restam "+remaining+" segundos.";
        if(remaining<=0){clearInterval(timer);node.props.objectState="idle";node.props.message="O tempo acabou.";node.props.display="00";renderAll();scheduleSave();playTone(440,.35);}
      },250);
    }}
  ]);
}
function runObjectAction(node,action) {
  if(!node) return;
  if(!isGM && isOwlbear && !["safe-open","lock-open","radio-tune"].includes(action)) {
    sendMasterRequest(action,node.id,{});
    return toast("Interação enviada ao mestre.");
  }
  if(!canEdit && isGM===false && !["safe-open","lock-open","radio-tune"].includes(action))return toast("Este objeto está em modo de consulta.");
  const change=(fn)=>{remember();fn();renderAll();scheduleSave();};
  switch(action){
    case "safe-open":return showSafePuzzle(node);
    case "lock-open":return showLockPuzzle(node);
    case "radio-tune":return showRadioPuzzle(node);
    case "crystal-open":return showCrystal(node);
    case "tarot-draw":return tarotDraw(node);
    case "scale-test":return showScale(node);
    case "ouija-open":return showOuija(node);
    case "music-toggle":return change(()=>{node.props.objectState=node.props.objectState==="on"?"idle":"on";node.props.message=node.props.objectState==="on"?"A melodia toca lentamente.":"A caixa de música foi interrompida.";});
    case "pendulum-toggle":return change(()=>{node.props.objectState=node.props.objectState==="on"?"idle":"on";node.props.message=node.props.objectState==="on"?"O pêndulo começou a oscilar.":"O pêndulo está imóvel.";});
    case "emf-toggle":return change(()=>{const val=Math.floor(Math.random()*6);node.props.display="NÍVEL "+val;node.props.message=val>=4?"Atividade paranormal elevada.":"Atividade fraca ou inexistente.";});
    case "thermometer-read":return change(()=>{const val=(Math.random()*20-2).toFixed(1);node.props.display=val+" °C";node.props.message=Number(val)<5?"Queda brusca de temperatura.":"Temperatura dentro do esperado.";});
    case "candle-toggle":case "incense-toggle":case "bulb-toggle":return change(()=>{node.props.objectState=node.props.objectState==="on"?"idle":"on";node.props.message=node.props.objectState==="on"?"O objeto foi aceso.":"O objeto foi apagado.";});
    case "cauldron-stir":return change(()=>{node.props.objectState="on";node.props.message=["A mistura começa a borbulhar.","Um vapor violeta sobe do caldeirão.","O líquido muda de cor.","Uma forma aparece por um instante."][Math.floor(Math.random()*4)];playTone(180,.16);});
    case "skull-speak":return openModal("Crânio falante",'<p>'+esc(secretFor(node.id).message||node.props.message||"O crânio não responde.")+'</p>',[{label:"Fechar",primary:true,action:closeModal}]);
    case "mirror-toggle":return change(()=>{node.props.objectState=node.props.objectState==="on"?"idle":"on";node.props.message=node.props.objectState==="on"?(node.props.objectType==="vampireMirror"?"O espelho não mostra reflexo algum.":"Uma figura aparece atrás de você."):"O reflexo desaparece.";});
    case "holy-water":return openModal("Água benta",'<p>O frasco contém um líquido claro. Há um selo preso ao gargalo.</p>',[{label:"Fechar",primary:true,action:closeModal}]);
    case "watch-toggle":return change(()=>{node.props.objectState="on";node.props.message="O relógio volta a funcionar.";node.props.display=new Date().toLocaleTimeString("pt-BR");});
    case "timer-toggle":return showTimer(node);
    case "vhs-toggle":case "tv-toggle":return change(()=>{node.props.objectState=node.props.objectState==="on"?"idle":"on";node.props.display=node.props.objectState==="on"?"PLAY ▸": "SEM SINAL";node.props.message=node.props.objectState==="on"?"A fita começa a rodar.":"A imagem desaparece.";});
    case "portal-toggle":return change(()=>{node.props.objectState=node.props.objectState==="on"?"idle":"on";node.props.message=node.props.objectState==="on"?"O vazio se abre e começa a girar.":"A passagem se fecha.";});
    case "mask-toggle":return change(()=>{boardState.settings.effects.mask=!boardState.settings.effects.mask;});
    case "wisp-toggle":return change(()=>{boardState.settings.effects.wisp=!boardState.settings.effects.wisp;});
    case "cat-toggle":return change(()=>{boardState.settings.lamp=true;node.props.message="Dois olhos refletem a luz na escuridão.";});
    case "wall-search":return change(()=>{node.props.message="Você encontrou uma emenda irregular nos tijolos.";node.props.objectState="on";});
    case "pouch-open":return change(()=>{node.props.message="O aroma é intenso. Um papel dobrado está escondido entre as ervas.";});
    case "switch-toggle":return change(()=>{node.props.objectState=node.props.objectState==="on"?"idle":"on";});
    case "dial-turn":return change(()=>{node.props.position=((Number(node.props.position||0)+25)%100);node.props.message="Disco na posição "+node.props.position+".";});
    case "key-use":return openModal("Chave antiga",'<p>Uma chave de ferro, marcada pelo tempo. Ela pode abrir uma maleta ou mecanismo compatível.</p>',[{label:"Fechar",primary:true,action:closeModal}]);
    case "coin-flip":return change(()=>{node.props.message=Math.random()>.5?"A moeda caiu com a face marcada para cima.":"A moeda caiu com o reverso para cima.";});
    case "trigger-toggle":
      if(!isGM)return toast("Somente o mestre pode acionar este mecanismo.");
      return change(()=>{node.props.activated=!node.props.activated;node.props.message=node.props.activated?"Gatilho ativado.":"Gatilho desativado.";});
    case "tree-state":return change(()=>{node.props.treeState=node.props.treeState==="locked"?"available":node.props.treeState==="available"?"solved":"locked";});
    case "generic":return toast(node.props.message||"Objeto selecionado.");
  }
}
function playTone(freq=220,duration=.12,type="sine") {
  try {
    audioContext=audioContext || new (window.AudioContext||window.webkitAudioContext)();
    if(audioContext.state==="suspended")audioContext.resume();
    const osc=audioContext.createOscillator(),gain=audioContext.createGain();
    osc.type=type;osc.frequency.setValueAtTime(freq,audioContext.currentTime);
    gain.gain.setValueAtTime(.08,audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+duration);
    osc.connect(gain);gain.connect(audioContext.destination);
    osc.start();osc.stop(audioContext.currentTime+duration);
  } catch(error) { console.info("Áudio não disponível.",error); }
}
function renderEffects() {
  const fx=boardState.settings.effects,layer=$("fx-ash");
  const particles=[];
  const count=(fx.ash?18:0)+(fx.bats?3:0)+(fx.rain?30:0)+(fx.snow?22:0)+(fx.embers?18:0)+(fx.eyes?3:0);
  for(let i=0;i<count;i++) {
    const kind=fx.bats&&i<3?"bat":fx.rain&&i<30?"rain":fx.snow&&i<(fx.rain?30:0)+22?"snow":fx.embers&&i>(fx.rain?30:0)+(fx.snow?22:0)?"ember":fx.eyes&&i>count-3?"eye":"ash";
    const left=Math.random()*100,delay=Math.random()*-18,duration=kind==="rain"?1+Math.random()*1.2:kind==="bat"?7+Math.random()*5:10+Math.random()*24;
    const content=kind==="bat"?"🦇":kind==="eye"?"◉":kind==="snow"?"❄":kind==="ember"?"✦":"·";
    const color=kind==="eye"?"#a9ef88":kind==="ember"?"#ff9a3c":kind==="ash"?"#d8c7af":"#e8e2d4";
    particles.push('<span style="position:absolute;left:'+left+'%;top:-30px;color:'+color+';font-size:'+(kind==="bat"?18:kind==="eye"?14:8+Math.random()*8)+'px;opacity:'+(kind==="eye"?.8:.35+Math.random()*.45)+';animation:qiParticle '+duration+'s linear '+delay+'s infinite">'+content+'</span>');
  }
  layer.innerHTML=particles.join("");
  const mode=boardState.settings.light.mode;
  document.body.classList.toggle("lamp-on",!!boardState.settings.lamp || mode==="lamp" || mode==="room");
  document.body.classList.toggle("torch-on",!!boardState.settings.torch || mode==="torch");
  document.body.classList.toggle("uv-on",!!boardState.settings.uv || mode==="uv");
  $("dark-overlay").style.opacity=(boardState.settings.torch || mode==="torch")?"1":(boardState.settings.lamp||mode==="lamp"||mode==="room")?".38":"0";
  if(boardState.settings.sanity.enabled) $("sanity-widget").classList.add("show");
}
(function installParticleCss(){
  if(document.getElementById("qi-particle-css"))return;
  const st=document.createElement("style");st.id="qi-particle-css";
  st.textContent="@keyframes qiParticle{0%{transform:translate3d(-3vw,-3vh,0) rotate(0);opacity:0}10%{opacity:.75}100%{transform:translate3d(5vw,110vh,0) rotate(360deg);opacity:0}}";
  document.head.appendChild(st);
})();
function startAmbient(mode) {
  stopAmbient();
  try {
    audioContext=audioContext || new (window.AudioContext||window.webkitAudioContext)();
    if(audioContext.state==="suspended")audioContext.resume();
    const gain=audioContext.createGain();gain.gain.value=Number(boardState.settings.audio.general)/100*.06;gain.connect(audioContext.destination);
    const osc=audioContext.createOscillator();osc.type="sine";osc.frequency.value=mode==="wind"?68:mode==="static"?1200:42;
    const filter=audioContext.createBiquadFilter();filter.type="lowpass";filter.frequency.value=mode==="static"?2400:250;
    osc.connect(filter);filter.connect(gain);osc.start();
    ambientNodes={osc:osc,gain:gain,filter:filter};
    boardState.settings.audio.ambience=mode;
    scheduleSave();toast("Ambiente sonoro iniciado.");
  } catch(error) { toast("O navegador bloqueou o áudio ambiente."); }
}
function stopAmbient() {
  if(!ambientNodes)return;
  try{ambientNodes.osc.stop();ambientNodes.gain.disconnect();}catch(error){}
  ambientNodes=null;
  boardState.settings.audio.ambience="none";
  scheduleSave();
}


function addPin(node,localX=null,localY=null) {
  if(!canEdit)return toast("Apenas o mestre pode modificar os pins.");
  remember();
  const x=localX==null?node.w-24:clamp(localX,0,node.w-18);
  const y=localY==null?Math.round(node.h*.45):clamp(localY,0,node.h-18);
  node.pins=node.pins||[];
  const pin={id:uid("pin"),x:x,y:y,label:"Pista "+(node.pins.length+1)};
  node.pins.push(pin);renderItems();scheduleSave();toast("Pin adicionado.");
}
function connectPins(a,b) {
  if(!a||!b)return;
  if(a.nodeId===b.nodeId && a.pinId===b.pinId){wireStart=null;renderWires();return;}
  const exists=boardState.wires.some((w)=>(
    (w.from.nodeId===a.nodeId&&w.from.pinId===a.pinId&&w.to.nodeId===b.nodeId&&w.to.pinId===b.pinId)||
    (w.from.nodeId===b.nodeId&&w.from.pinId===b.pinId&&w.to.nodeId===a.nodeId&&w.to.pinId===a.pinId)
  ));
  if(exists){wireStart=null;renderWires();return toast("Esses pins já estão conectados.");}
  remember();boardState.wires.push({id:uid("wire"),from:a,to:b,label:"Conexão"});
  wireStart=null;renderWires();renderHeader();scheduleSave();toast("Conexão criada.");
}
function deleteSelected() {
  if(!selectedIds.length)return;
  if(!canEdit)return toast("Apenas o mestre pode excluir evidências.");
  remember();
  const ids=new Set(selectedIds);
  boardState.nodes=boardState.nodes.filter((node)=>!ids.has(node.id));
  boardState.wires=boardState.wires.filter((wire)=>!ids.has(wire.id)&&!ids.has(wire.from.nodeId)&&!ids.has(wire.to.nodeId));
  selectedIds.forEach((id)=>{delete privateData[id];});
  persistPrivate();selectedIds=[];renderAll();scheduleSave();toast("Seleção removida.");
}
function duplicateSelected() {
  if(!canEdit)return toast("Apenas o mestre pode duplicar evidências.");
  const selected=getSelected();
  if(!selected.length)return;
  remember();
  const map=new Map();
  const copies=selected.map((source)=>{
    const copy=clone(source),oldId=copy.id;
    copy.id=uid("ev");copy.x+=36;copy.y+=36;copy.z=(copy.z||1)+1;
    copy.pins=(copy.pins||[]).map((pin)=>{const old=pin.id;pin.id=uid("pin");map.set(old,pin.id);return pin;});
    map.set(oldId,copy.id);
    return copy;
  });
  boardState.nodes.push(...copies);
  selectedIds=copies.map((n)=>n.id);
  renderAll();scheduleSave();toast("Evidências duplicadas.");
}
function setLayer(direction) {
  const nodes=getSelected();if(!nodes.length)return;
  remember();
  const top=Math.max(0,...boardState.nodes.map((n)=>n.z||0));
  nodes.forEach((node)=>node.z=direction==="front"?top+1:Math.max(0,(node.z||1)-1));
  renderItems();scheduleSave();
}
function flipSelected() {
  const nodes=getSelected();if(!nodes.length)return;
  remember();nodes.forEach((node)=>{node.face=node.face==="back"?"front":"back";if(node.type==="image")node.flipX=!node.flipX;});
  renderItems();scheduleSave();
}
function clearBoard() {
  if(!isGM)return toast("Apenas o mestre pode limpar o quadro.");
  openModal("Limpar quadro atual","<p>Esta ação remove as evidências, fios e marcações do quadro aberto. Exporte um backup antes de continuar.</p>",[
    {label:"Cancelar",action:closeModal},
    {label:"Limpar quadro",primary:true,action:()=>{remember();boardState.nodes=[];boardState.wires=[];boardState.marks=[];selectedIds=[];closeModal();renderAll();scheduleSave();}}
  ]);
}
function switchBoard(id) {
  if(!workspace.boards.some((b)=>b.id===id))return;
  updateWorkspaceReference();
  workspace.activeId=id;bindActiveBoard();selectedIds=[];undoStack=[];redoStack=[];
  tx=boardState.camera.x||0;ty=boardState.camera.y||0;zoom=boardState.camera.zoom||.72;
  renderAll();scheduleSave();toast("Quadro aberto: "+boardState.name);
}
function createBoardEntry() {
  if(!isGM)return toast("Apenas o mestre pode criar quadros.");
  openModal("Novo quadro de investigação",'<div class="field"><label>Nome do quadro</label><input id="new-board-name" value="Novo caso investigativo"></div>',[
    {label:"Cancelar",action:closeModal},
    {label:"Criar quadro",primary:true,action:()=>{
      const name=$("new-board-name").value.trim()||"Novo caso";
      updateWorkspaceReference();
      const b=createBoard(name);workspace.boards.push({id:b.id,name:name,data:b});workspace.activeId=b.id;
      bindActiveBoard();selectedIds=[];undoStack=[];redoStack=[];frameBoard();closeModal();renderAll();scheduleSave();
    }}
  ]);
}
function renameBoard() {
  openModal("Renomear quadro",'<div class="field"><label>Nome</label><input id="rename-board-name" value="'+esc(boardState.name)+'"></div>',[
    {label:"Cancelar",action:closeModal},
    {label:"Salvar nome",primary:true,action:()=>{
      const name=$("rename-board-name").value.trim();if(!name)return;
      boardState.name=name;updateWorkspaceReference();closeModal();renderAll();scheduleSave();
    }}
  ]);
}
function bookEditor(node) {
  const pages=node.props.pages||[];
  const index=clamp(Number(node.props.page||0),0,Math.max(0,pages.length-1));
  const page=pages[index]||{title:"Página "+(index+1),body:""};
  openModal("Caderno de investigação",'<div class="book-pages">'+pages.map((p,i)=>'<button data-book-page="'+i+'" class="'+(i===index?"active":"")+'">'+(i+1)+'</button>').join("")+'</div><div class="field"><label>Título da página</label><input id="book-page-title" value="'+esc(page.title)+'"></div><div class="field"><label>Conteúdo manuscrito</label><textarea id="book-page-body" class="book-editor notebook-lines">'+esc(page.body)+'</textarea></div><div class="panel-actions"><button class="btn" id="book-prev">← Anterior</button><button class="btn" id="book-next">Próxima →</button><button class="btn" id="book-tear">Arrancar esta folha</button></div>',[
    {label:"Fechar",action:closeModal},
    {label:"Salvar página",primary:true,action:()=>{
      remember();const p=node.props.pages[index]||{title:"Página "+(index+1),body:""};
      p.title=$("book-page-title").value;p.body=$("book-page-body").value;node.props.pages[index]=p;node.props.page=index;
      closeModal();renderAll();scheduleSave();toast("Página salva.");
    }}
  ]);
  $("modal-body").addEventListener("click",(e)=>{
    const p=e.target.closest("[data-book-page]");
    if(p){const n=Number(p.dataset.bookPage);saveBookPageTemporary(node,index);node.props.page=n;bookEditor(node);}
    if(e.target.id==="book-prev"&&index>0){saveBookPageTemporary(node,index);node.props.page=index-1;bookEditor(node);}
    if(e.target.id==="book-next"){saveBookPageTemporary(node,index);if(index===pages.length-1){node.props.pages.push({title:"Página "+(pages.length+1),body:""});}node.props.page=Math.min(index+1,node.props.pages.length-1);bookEditor(node);}
    if(e.target.id==="book-tear"){saveBookPageTemporary(node,index);tearBookPage(node,index);closeModal();}
  });
}
function saveBookPageTemporary(node,index) {
  const page=node.props.pages[index];if(!page)return;
  const title=$("book-page-title"),body=$("book-page-body");
  if(title)page.title=title.value;if(body)page.body=body.value;
  scheduleSave();
}
function tearBookPage(node,index) {
  const pages=node.props.pages||[];if(pages.length<=1)return toast("O caderno precisa manter pelo menos uma página.");
  const page=pages.splice(index,1)[0];
  const leaf=addNode("leaf",{title:page.title||"Folha arrancada",body:page.body||"",filename:"FOLHA ARRANCADA",w:235,h:260});
  node.props.page=clamp(index-1,0,pages.length-1);
  selectedIds=[leaf.id];renderAll();scheduleSave();toast("Folha arrancada do caderno.");
}
function exportJSON(gm=false) {
  updateWorkspaceReference();
  const payload=gm?{app:"Sistema-Investigacao",version:3,workspace:workspace,privateData:privateData}:
    {app:"Sistema-Investigacao",version:3,workspace:publicWorkspace()};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
  downloadBlob(blob,"quadro-investigativo-"+slug(boardState.name)+(gm?"-mestre":"")+".json");
}
function slug(value){return String(value||"caso").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"caso";}
function downloadBlob(blob,name) {
  const url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=name;a.style.display="none";document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportShareCode() {
  const json=JSON.stringify(publicWorkspace());
  const code=btoa(unescape(encodeURIComponent(json)));
  openModal("Código de compartilhamento",'<p>Copie o código para levar esta mesa a outro dispositivo.</p><textarea id="share-code" style="min-height:150px;font:10px ui-monospace">'+code+'</textarea>',[
    {label:"Fechar",action:closeModal},
    {label:"Copiar código",primary:true,action:()=>{const el=$("share-code");el.select();document.execCommand("copy");toast("Código copiado.");}}
  ]);
}
function importShareCode() {
  openModal("Importar código",'<p>Cole abaixo o código de compartilhamento.</p><textarea id="share-code" style="min-height:150px;font:10px ui-monospace"></textarea>',[
    {label:"Cancelar",action:closeModal},
    {label:"Importar",primary:true,action:()=>{
      try {
        const decoded=decodeURIComponent(escape(atob($("share-code").value.trim())));
        const incoming=normalizeWorkspace(JSON.parse(decoded));
        remember();workspace=incoming;bindActiveBoard();selectedIds=[];closeModal();renderAll();scheduleSave();toast("Quadro importado.");
      } catch(error) { toast("Código inválido ou incompleto."); }
    }}
  ]);
}
function importJSONFile(file,gm=false) {
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const data=JSON.parse(String(reader.result||""));
      const next=normalizeWorkspace(data.workspace||data);
      remember();workspace=next;bindActiveBoard();
      if(gm&&data.privateData){privateData=Object.assign({},data.privateData);persistPrivate();}
      selectedIds=[];renderAll();scheduleSave();toast("Arquivo de investigação importado.");
    }catch(error){toast("Arquivo JSON inválido.");}
  };
  reader.readAsText(file);
}
function addImageFromFile(file) {
  if(!file)return;
  const type=(file.type||"").toLowerCase(),name=file.name||"Evidência";
  const reader=new FileReader();
  reader.onload=()=>{
    const data=String(reader.result||"");
    if(type.startsWith("image/")) {
      const image=new Image();
      image.onload=()=>{
        const scale=Math.min(1,1400/Math.max(image.naturalWidth,image.naturalHeight));
        const w=Math.max(1,Math.round(image.naturalWidth*scale)),h=Math.max(1,Math.round(image.naturalHeight*scale));
        const canvas=document.createElement("canvas");canvas.width=w;canvas.height=h;
        canvas.getContext("2d").drawImage(image,0,0,w,h);
        const compressed=canvas.toDataURL("image/jpeg",.78);
        addNode(fileTarget==="map"?"map":"image",{title:name.replace(/\.[^.]+$/,""),filename:name,mime:"image/jpeg",src:compressed,w:clamp(w,150,650),h:clamp(h,110,520)});
        fileTarget="image";
      };
      image.onerror=()=>toast("Não foi possível carregar a imagem.");
      image.src=data;return;
    }
    if(type.startsWith("text/") || /\.(txt|md|csv|log)$/i.test(name)) {
      const content=data.startsWith("data:")?atob(data.split(",")[1]):data;
      addNode("document",{title:name.replace(/\.[^.]+$/,""),filename:name,body:content.slice(0,12000),w:280,h:300});return;
    }
    if(type==="application/pdf" || /\.pdf$/i.test(name)) {
      if(data.length>1800000)return toast("PDF muito grande. Use um link externo ou um arquivo menor.");
      addNode("pdf",{title:name.replace(/\.pdf$/i,""),filename:name,src:data,body:"Documento PDF anexado."});return;
    }
    if(type.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|webm)$/i.test(name)) {
      if(data.length>1800000)return toast("Áudio muito grande para a cena. Use um arquivo compactado ou link externo.");
      addNode("audio",{title:name.replace(/\.[^.]+$/,""),filename:name,src:data,body:"Gravação de evidência."});return;
    }
    toast("Formato não suportado.");
  };
  reader.readAsDataURL(file);
}
async function importOwlbearImages() {
  if(!OBR_API)return toast("Abra a extensão dentro do Owlbear Rodeo para acessar a biblioteca.");
  try {
    const assets=await OBR_API.assets.downloadImages(true,"","ATTACHMENT");
    if(!assets||!assets.length)return;
    assets.forEach((asset)=>{
      const src=asset.image&&asset.image.url;
      if(src)addNode("image",{title:asset.name||"Imagem da biblioteca",filename:asset.name||"Owlbear Asset",src:src,w:260,h:200});
    });
  } catch(error) { toast("Não foi possível abrir a biblioteca de imagens."); }
}
function exportItemPNG(node) {
  const canvas=document.createElement("canvas");
  canvas.width=clamp(node.w*2,120,1800);canvas.height=clamp(node.h*2,100,1400);
  const ctx=canvas.getContext("2d");
  ctx.fillStyle=node.type==="note"?"#eedc72":"#eee4d1";ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.strokeStyle="#34251b";ctx.lineWidth=4;ctx.strokeRect(2,2,canvas.width-4,canvas.height-4);
  if(node.type==="image" || node.type==="map") {
    const im=new Image();im.onload=()=>{ctx.drawImage(im,0,0,canvas.width,canvas.height);canvas.toBlob((b)=>downloadBlob(b,slug(node.title)+".png"));};im.src=safeSrc(node.src);return;
  }
  ctx.fillStyle="#332316";ctx.font="bold 26px Georgia";ctx.fillText(node.title||"Evidência",24,42);
  ctx.font="22px monospace";
  const lines=String(node.body||node.props.message||"").split(/\n/);
  lines.forEach((line,i)=>ctx.fillText(line.slice(0,70),24,82+i*30));
  canvas.toBlob((b)=>downloadBlob(b,slug(node.title)+".png"));
}
function exportBoardPNG() {
  const nodes=boardState.nodes.filter((n)=>isGM||!n.gmOnly);
  if(!nodes.length)return toast("Não há evidências para exportar.");
  const minX=Math.min(...nodes.map((n)=>n.x)),minY=Math.min(...nodes.map((n)=>n.y));
  const maxX=Math.max(...nodes.map((n)=>n.x+n.w)),maxY=Math.max(...nodes.map((n)=>n.y+n.h));
  const scale=Math.min(1,2600/Math.max(maxX-minX,maxY-minY));
  const canvas=document.createElement("canvas");canvas.width=Math.max(1,(maxX-minX)*scale);canvas.height=Math.max(1,(maxY-minY)*scale);
  const ctx=canvas.getContext("2d");ctx.fillStyle="#30251b";ctx.fillRect(0,0,canvas.width,canvas.height);
  nodes.forEach((node)=>{
    const x=(node.x-minX)*scale,y=(node.y-minY)*scale,w=node.w*scale,h=node.h*scale;
    ctx.fillStyle=node.type==="note"?"#f2df6f":node.type==="object"?"#322218":"#e9dfc7";
    ctx.fillRect(x,y,w,h);ctx.strokeStyle="#140d08";ctx.lineWidth=2;ctx.strokeRect(x,y,w,h);
    ctx.fillStyle=node.type==="object"?"#e7d4ad":"#251910";ctx.font=(13*scale+6)+"px Georgia";ctx.fillText(node.title||"Evidência",x+8*scale,y+20*scale);
    if(node.type==="image"||node.type==="map") {
      const image=new Image();image.onload=()=>ctx.drawImage(image,x,y+25*scale,w,h-25*scale);image.src=safeSrc(node.src);
    } else {
      ctx.font=(11*scale+5)+"px monospace";
      String(node.body||node.props.message||"").split(/\n/).slice(0,12).forEach((line,i)=>ctx.fillText(line.slice(0,55),x+8*scale,y+(48+i*14)*scale));
    }
  });
  setTimeout(()=>canvas.toBlob((blob)=>downloadBlob(blob,slug(boardState.name)+".png")),300);
}
function toggleMinimap() {
  minimapVisible=!minimapVisible;
  $("minimap").hidden=!minimapVisible;
  renderMinimap();
}
function showHelp(){$("help-overlay").classList.add("show");}
function hideHelp(){$("help-overlay").classList.remove("show");}


function pointerDown(e) {
  if(e.button===2){e.preventDefault();const item=e.target.closest(".item");if(item){selectNode(item.dataset.item);showContextMenu(item.dataset.item,e.clientX,e.clientY);}return;}
  if(e.target.closest("button,input,textarea,select,a,audio,[contenteditable=true]"))return;
  const pin=e.target.closest(".pin-dot");
  if(pin)return;
  const itemEl=e.target.closest(".item");
  if(currentTool==="mark" && !e.target.closest(".pin-dot")) {
    const p=screenToWorld(e.clientX,e.clientY);drawState={kind:"mark",points:[p],start:p};
    viewport.setPointerCapture(e.pointerId);e.preventDefault();return;
  }
  if((currentTool==="fog" || currentTool==="reveal") && itemEl) {
    const map=getNode(itemEl.dataset.item);
    if(map && map.type==="map") {
      const rect=itemEl.getBoundingClientRect(),local={x:(e.clientX-rect.left)/zoom,y:(e.clientY-rect.top)/zoom};
      remember();drawState={kind:"fog",nodeId:map.id,stroke:{mode:currentTool==="reveal"?"reveal":"hide",radius:34,points:[local]}};
      viewport.setPointerCapture(e.pointerId);drawFog(map);e.preventDefault();return;
    }
  }
  if(itemEl) {
    const node=getNode(itemEl.dataset.item);if(!node)return;
    if(currentTool==="pin"){const rect=itemEl.getBoundingClientRect();addPin(node,(e.clientX-rect.left)/zoom-8,(e.clientY-rect.top)/zoom-8);return;}
    if(currentTool==="wire"){selectNode(node.id);toast("Clique em um pin para iniciar a conexão.");return;}
    if(currentTool==="lens"){moveLens(e.clientX,e.clientY);return;}
    if(currentTool==="scratch" && node.type==="scratch"){scratchAt(node,e.clientX,e.clientY);return;}
    if(currentTool==="select" && node.locked && !isGM){toast("Esta evidência está bloqueada.");return;}
    if(currentTool==="select" && node.locked && isGM){toast("Desbloqueie a evidência no painel antes de movê-la.");return;}
    selectNode(node.id,e.shiftKey);
    const handle=e.target.closest(".item-handle");
    if(handle && canEdit) {
      remember();
      const p=screenToWorld(e.clientX,e.clientY);
      if(handle.dataset.handle==="resize")drag={type:"resize",id:node.id,startX:p.x,startY:p.y,w:node.w,h:node.h,lastX:p.x,lastY:p.y};
      else {
        const center={x:node.x+node.w/2,y:node.y+node.h/2};
        drag={type:"rotate",id:node.id,center:center,startAngle:Math.atan2(p.y-center.y,p.x-center.x),rotation:node.rotation||0};
      }
    } else if(canEdit && currentTool==="select" && !node.locked) {
      remember();
      const p=screenToWorld(e.clientX,e.clientY);
      const selected=getSelected().filter((n)=>!n.locked);
      drag={type:"move",id:node.id,startX:p.x,startY:p.y,lastX:p.x,lastY:p.y,
        group:selected.map((n)=>({id:n.id,x:n.x,y:n.y})),vx:0,vy:0,lastTime:performance.now()};
    }
    viewport.setPointerCapture(e.pointerId);
    e.preventDefault();return;
  }
  if(e.target.closest("[data-wire-id]")) {
    selectedIds=[e.target.closest("[data-wire-id]").dataset.wireId];renderWires();renderInspector();return;
  }
  if(currentTool==="pan" || spaceDown || e.button===1) {
    pan={x:e.clientX,y:e.clientY,tx:tx,ty:ty};viewport.setPointerCapture(e.pointerId);document.body.classList.add("panning");return;
  }
  if(currentTool==="note") {const p=screenToWorld(e.clientX,e.clientY);const n=addNode("note");n.x=p.x;n.y=p.y;renderAll();scheduleSave();return;}
  if(currentTool==="pin") {const p=screenToWorld(e.clientX,e.clientY);const n=addNode("note",{title:"Ponto de evidência",body:"Descreva a pista localizada aqui.",w:185,h:125});n.x=p.x;n.y=p.y;n.pins=[{id:uid("pin"),x:80,y:5,label:"Ponto"}];renderAll();scheduleSave();return;}
  if(currentTool==="image") {fileTarget="image";$("file-input").click();return;}
  if(currentTool==="object") {setPanel("catalog");return;}
  if(currentTool==="tape") {const p=screenToWorld(e.clientX,e.clientY);const n=addNode("tape");n.x=p.x;n.y=p.y;renderAll();scheduleSave();return;}
  if(currentTool==="scratch") {const p=screenToWorld(e.clientX,e.clientY);const n=addNode("scratch");n.x=p.x;n.y=p.y;renderAll();scheduleSave();return;}
  if(currentTool==="lens"){moveLens(e.clientX,e.clientY);return;}
  if(currentTool==="mark") {
    const p=screenToWorld(e.clientX,e.clientY);drawState={kind:"mark",points:[p],start:p};
    viewport.setPointerCapture(e.pointerId);return;
  }
  if(currentTool==="fog" || currentTool==="reveal") {
    const mapEl=e.target.closest(".item[data-item]");
    const map=mapEl&&getNode(mapEl.dataset.item);
    if(!map||map.type!=="map"){toast("A ferramenta de névoa precisa de um mapa.");return;}
    const rect=mapEl.getBoundingClientRect(),p={x:(e.clientX-rect.left)/zoom,y:(e.clientY-rect.top)/zoom};
    remember();
    drawState={kind:"fog",nodeId:map.id,stroke:{mode:currentTool==="reveal"?"reveal":"hide",radius:32,points:[p]}};
    viewport.setPointerCapture(e.pointerId);drawFog(map);return;
  }
  if(currentTool==="select" && !e.shiftKey) {
    selectedIds=[];syncSelectionClass();
  }
  if(currentTool==="select" && e.shiftKey) {
    const p=screenToWorld(e.clientX,e.clientY);drawState={kind:"marquee",start:p,current:p};
    viewport.setPointerCapture(e.pointerId);
  }
}
let spaceDown=false;
function pointerMove(e) {
  const rect=viewport.getBoundingClientRect();
  torchPoint={x:clamp((e.clientX-rect.left)/rect.width*100,0,100),y:clamp((e.clientY-rect.top)/rect.height*100,0,100)};
  viewport.style.setProperty("--mx",torchPoint.x+"%");
  viewport.style.setProperty("--my",torchPoint.y+"%");
  updateLight();
  if(lensVisible)moveLens(e.clientX,e.clientY);
  if(drag) {
    const p=screenToWorld(e.clientX,e.clientY);
    const node=getNode(drag.id);if(!node)return;
    if(drag.type==="move") {
      const dx=p.x-drag.startX,dy=p.y-drag.startY;
      drag.group.forEach((g)=>{
        const n=getNode(g.id);if(n){n.x=g.x+dx;n.y=g.y+dy;}
      });
      const now=performance.now(),dt=Math.max(1,now-drag.lastTime);
      drag.vx=(p.x-drag.lastX)/dt*16;drag.vy=(p.y-drag.lastY)/dt*16;
      drag.lastX=p.x;drag.lastY=p.y;drag.lastTime=now;
    } else if(drag.type==="resize") {
      node.w=clamp(drag.w+(p.x-drag.startX),60,1200);
      node.h=clamp(drag.h+(p.y-drag.startY),45,900);
    } else if(drag.type==="rotate") {
      const angle=Math.atan2(p.y-drag.center.y,p.x-drag.center.x);
      node.rotation=drag.rotation+(angle-drag.startAngle)*180/Math.PI;
    }
    updateItemPosition(drag.group?drag.group.map((g)=>g.id):[node.id]);
    renderWires();renderMinimap();return;
  }
  if(pan) {
    tx=pan.tx+(e.clientX-pan.x);ty=pan.ty+(e.clientY-pan.y);
    updateTransform();return;
  }
  if(drawState) {
    const p=screenToWorld(e.clientX,e.clientY);
    if(drawState.kind==="mark") {
      drawState.points.push(p);
      const temp={id:"temp",kind:"free",points:drawState.points};
      const old=boardState.marks;boardState.marks=[...old,temp];renderMarks();boardState.marks=old;
    } else if(drawState.kind==="fog") {
      const node=getNode(drawState.nodeId);if(!node)return;
      const el=itemLayer.querySelector('[data-item="'+node.id+'"]'),r=el.getBoundingClientRect();
      const local={x:(e.clientX-r.left)/zoom,y:(e.clientY-r.top)/zoom};
      drawState.stroke.points.push(local);node.props.fogStrokes=node.props.fogStrokes||[];
      const canvas=el.querySelector("canvas");if(canvas) {
        const ctx=canvas.getContext("2d");const stroke=drawState.stroke;
        ctx.globalCompositeOperation=stroke.mode==="reveal"?"destination-out":"source-over";
        ctx.fillStyle="rgba(0,0,0,.96)";ctx.beginPath();ctx.arc(local.x,local.y,stroke.radius,0,Math.PI*2);ctx.fill();ctx.globalCompositeOperation="source-over";
      }
    } else if(drawState.kind==="marquee") {
      drawState.current=p;
      renderMarquee(drawState.start,drawState.current);
    }
  }
}
function updateItemPosition(ids) {
  ids.forEach((id)=>{
    const n=getNode(id),el=itemLayer.querySelector('[data-item="'+id+'"]');
    if(n&&el){el.style.left=n.x+"px";el.style.top=n.y+"px";el.style.width=n.w+"px";el.style.height=n.h+"px";el.style.transform="rotate("+n.rotation+"deg) scaleX("+(n.flipX?-1:1)+") scaleY("+(n.flipY?-1:1)+")";}
  });
}
function pointerUp() {
  if(drag) {
    const old=drag;drag=null;
    if(old.type==="move" && Math.abs(old.vx)+Math.abs(old.vy)>1.3) {
      let vx=old.vx,vy=old.vy,steps=0;const ids=old.group.map((g)=>g.id);
      const momentum=()=>{
        vx*=.88;vy*=.88;
        if(Math.abs(vx)+Math.abs(vy)<.4 || steps++>30){renderItems();scheduleSave();return;}
        old.group.forEach((g)=>{
          const n=getNode(g.id);if(n){n.x+=vx;n.y+=vy;}
        });
        repelOverlaps(ids);
        updateItemPosition(ids);renderWires();requestAnimationFrame(momentum);
      };
      requestAnimationFrame(momentum);
    } else {renderItems();scheduleSave();}
  }
  if(pan){pan=null;document.body.classList.remove("panning");scheduleSave();}
  if(drawState) {
    if(drawState.kind==="mark" && drawState.points.length>1) {
      remember();boardState.marks.push({id:uid("mark"),kind:"free",points:drawState.points,color:"#c32126",width:4});
      renderMarks();scheduleSave();
    } else if(drawState.kind==="fog") {
      const node=getNode(drawState.nodeId);
      if(node){node.props.fogStrokes=node.props.fogStrokes||[];node.props.fogStrokes.push(drawState.stroke);drawFog(node);scheduleSave();}
    } else if(drawState.kind==="marquee") {
      const a=drawState.start,b=drawState.current;
      const left=Math.min(a.x,b.x),right=Math.max(a.x,b.x),top=Math.min(a.y,b.y),bottom=Math.max(a.y,b.y);
      const found=boardState.nodes.filter((n)=>n.x+n.w>left&&n.x<right&&n.y+n.h>top&&n.y<bottom).map((n)=>n.id);
      selectedIds=Array.from(new Set(selectedIds.concat(found)));syncSelectionClass();
      $("marquee-temp")?.remove();
    }
    drawState=null;
  }
  wireStart=null;renderWires();
}
function repelOverlaps(ids) {
  const moving=new Set(ids);
  ids.forEach((id)=>{
    const n=getNode(id);if(!n)return;
    boardState.nodes.forEach((other)=>{
      if(moving.has(other.id))return;
      const ox=Math.min(n.x+n.w,other.x+other.w)-Math.max(n.x,other.x);
      const oy=Math.min(n.y+n.h,other.y+other.h)-Math.max(n.y,other.y);
      if(ox>0&&oy>0){if(ox<oy)other.x+=(other.x<n.x?-1:1)*Math.min(6,ox*.04);else other.y+=(other.y<n.y?-1:1)*Math.min(6,oy*.04);}
    });
  });
}
function renderMarquee(a,b) {
  let el=$("marquee-temp");
  if(!el){el=document.createElement("div");el.id="marquee-temp";el.style.cssText="position:absolute;border:1px dashed #ffd678;background:#ffd67818;pointer-events:none;z-index:40";world.appendChild(el);}
  el.style.left=Math.min(a.x,b.x)+"px";el.style.top=Math.min(a.y,b.y)+"px";
  el.style.width=Math.abs(b.x-a.x)+"px";el.style.height=Math.abs(b.y-a.y)+"px";
}
function moveLens(clientX,clientY) {
  const rect=viewport.getBoundingClientRect(),lens=$("lens");
  lensVisible=true;lens.classList.add("show");
  lens.style.left=clamp(clientX-rect.left-115,0,rect.width-230)+"px";
  lens.style.top=clamp(clientY-rect.top-115,0,rect.height-230)+"px";
  const p=screenToWorld(clientX,clientY);
  $("lens-content").innerHTML=world.innerHTML.replace(/id="marquee-temp"/g,'');
  $("lens-content").style.transform="translate("+(-p.x*lensZoom+115)+"px,"+(-p.y*lensZoom+115)+"px) scale("+lensZoom+")";
}
function hideLens(){lensVisible=false;$("lens").classList.remove("show");}
function scratchAt(node,clientX,clientY) {
  if(node.props.revealed)return;
  remember();
  node.props.progress=clamp(Number(node.props.progress||0)+12,0,100);
  if(node.props.progress>=100){node.props.revealed=true;toast("A raspadinha revelou sua mensagem.");}
  renderItems();scheduleSave();
}
function showContextMenu(id,x,y) {
  document.getElementById("context-menu")?.remove();
  const menu=document.createElement("div");menu.id="context-menu";
  menu.style.cssText="position:fixed;z-index:200;left:"+clamp(x,8,window.innerWidth-180)+"px;top:"+clamp(y,8,window.innerHeight-240)+"px;display:grid;min-width:160px;padding:5px;background:#24170f;border:1px solid #8c653a;box-shadow:0 10px 30px #0009";
  menu.innerHTML='<button data-context="edit">Editar propriedades</button><button data-context="pin">Adicionar pin</button><button data-context="duplicate">Duplicar</button><button data-context="front">Trazer à frente</button><button data-context="delete">Excluir</button>';
  menu.querySelectorAll("button").forEach((b)=>{b.style.cssText="border:0;background:transparent;color:#ead6b2;text-align:left;padding:8px;font:600 11px var(--ui)";});
  document.body.appendChild(menu);
  menu.addEventListener("click",(e)=>{
    const b=e.target.closest("[data-context]");if(!b)return;
    selectedIds=[id];const node=getNode(id);
    if(b.dataset.context==="edit"){setPanel("properties");}
    if(b.dataset.context==="pin"&&node)addPin(node);
    if(b.dataset.context==="duplicate")duplicateSelected();
    if(b.dataset.context==="front")setLayer("front");
    if(b.dataset.context==="delete")deleteSelected();
    menu.remove();
  });
  setTimeout(()=>document.addEventListener("pointerdown",function close(e){if(!menu.contains(e.target)){menu.remove();document.removeEventListener("pointerdown",close);}}, {once:true}),0);
}
function handlePinClick(pin) {
  const current={nodeId:pin.dataset.pinNode,pinId:pin.dataset.pinId};
  if(currentTool==="wire") {
    if(!wireStart){wireStart=current;toast("Agora clique no pin de destino.");}
    else connectPins(wireStart,current);
    renderWires();return;
  }
  selectNode(current.nodeId);
}
function itemClick(e) {
  const pin=e.target.closest(".pin-dot");
  if(pin){e.stopPropagation();handlePinClick(pin);return;}
  const action=e.target.closest("[data-item-action]");
  if(action) {
    e.stopPropagation();
    const item=action.closest(".item"),node=item&&getNode(item.dataset.item);
    if(!node)return;
    const key=action.dataset.itemAction;
    if(key==="duplicate")return duplicateSelected();
    if(key==="delete")return deleteSelected();
    if(key==="flip")return flipSelected();
    if(key==="book-open")return bookEditor(node);
    if(key==="add-pin")return addPin(node);
    return runObjectAction(node,key);
  }
  const scratch=e.target.closest(".scratch-cover");
  if(scratch){const node=getNode(scratch.closest(".item").dataset.item);if(node)scratchAt(node,e.clientX,e.clientY);return;}
  const item=e.target.closest(".item");
  if(item) {
    const node=getNode(item.dataset.item);
    if(node && e.detail===2 && node.type==="note" && canEdit) {
      const body=item.querySelector(".item-body");
      if(body){body.contentEditable="true";body.focus();body.addEventListener("blur",()=>{remember();node.body=body.innerText;scheduleSave();body.contentEditable="false";},{once:true});}
    }
  }
}
function updateNodeField(node,key,value) {
  if(key==="title"||key==="label"||key==="body"||key==="backBody"||key==="caption"||key==="src"||key==="uvText")node[key]=value;
  else if(key==="w"||key==="h"||key==="rotation")node[key]=Number(value);
  else {node.props[key]=value;}
  updateWorkspaceReference();scheduleSave();
}
function inspectorClick(e) {
  const cat=e.target.closest("[data-catalog]");
  if(cat){addObject(cat.dataset.catalog);currentPanel="properties";setPanel("properties");return;}
  const board=e.target.closest("[data-board-id]");
  if(board){switchBoard(board.dataset.boardId);return;}
  const action=e.target.closest("[data-do]");
  if(!action)return;
  const id=action.dataset.do,node=getSelected()[0];
  switch(id) {
    case "new-note":addNode("note");break;
    case "new-document":addNode("document");break;
    case "new-object":setPanel("catalog");break;
    case "new-map":fileTarget="map";$("file-input").click();break;
    case "add-pin":if(node)addPin(node);break;
    case "duplicate":duplicateSelected();break;
    case "delete":deleteSelected();break;
    case "flip":flipSelected();break;
    case "front":setLayer("front");break;
    case "back":setLayer("back");break;
    case "export-png":if(node)exportItemPNG(node);break;
    case "interact":if(node)runObjectAction(node,""+({safe:"safe-open",lockbox:"lock-open",radio:"radio-tune",crystal:"crystal-open",tarot:"tarot-draw",scale:"scale-test",ouija:"ouija-open",tree:"tree-state"}[node.props.objectType]||"generic"));break;
    case "save-secret":if(node){const type=node.props.objectType,key=type==="safe"?"code":type==="lockbox"?"password":type==="radio"?"frequency":type==="crystal"?"vision":"message";setSecret(node,key,$("secret-setting").value).then(()=>toast("Segredo salvo no dispositivo do mestre."));}break;
    case "multi-lock":remember();getSelected().forEach((n)=>n.locked=!n.locked);renderAll();scheduleSave();break;
    case "book-open":if(node)bookEditor(node);break;
    case "book-add-page":if(node){remember();node.props.pages.push({title:"Página "+(node.props.pages.length+1),body:""});node.props.page=node.props.pages.length-1;renderAll();scheduleSave();}break;
    case "book-tear":if(node)tearBookPage(node,Number(node.props.page||0));break;
    case "new-board":createBoardEntry();break;
    case "rename-board":renameBoard();break;
    case "export-json":exportJSON(false);break;
    case "export-gm":exportJSON(true);break;
    case "import-json":$("json-input").dataset.gm="false";$("json-input").click();break;
    case "import-gm":$("json-input").dataset.gm="true";$("json-input").click();break;
    case "export-board-png":exportBoardPNG();break;
    case "clear-board":clearBoard();break;
    case "share-code":exportShareCode();break;
    case "import-code":importShareCode();break;
    case "toggle-uv":boardState.settings.uv=!boardState.settings.uv;renderAll();scheduleSave();break;
    case "toggle-lamp":boardState.settings.lamp=!boardState.settings.lamp;renderAll();scheduleSave();break;
    case "toggle-torch":boardState.settings.torch=!boardState.settings.torch;renderAll();scheduleSave();break;
    case "ambient-start":startAmbient(boardState.settings.audio.ambience==="none"?"wind":boardState.settings.audio.ambience);break;
    case "ambient-stop":stopAmbient();break;
  }
}
function inspectorInput(e) {
  const node=getSelected()[0];
  if(e.target.matches("[data-edit]")&&node) {
    node[e.target.dataset.edit]=e.target.value;
    const item=itemLayer.querySelector('[data-item="'+node.id+'"]');
    if(item) {
      if(e.target.dataset.edit==="title"){const title=item.querySelector(".item-title");if(title)title.textContent=node.title;}
      if(e.target.dataset.edit==="body"){const body=item.querySelector(".item-body");if(body)body.textContent=node.body;}
    }
    scheduleSave();return;
  }
  if(e.target.matches("[data-edit-num]")&&node) {
    node[e.target.dataset.editNum]=Number(e.target.value);
    updateItemPosition([node.id]);renderWires();scheduleSave();return;
  }
  if(e.target.matches("[data-edit-check]")&&node) {
    node[e.target.dataset.editCheck]=e.target.checked;renderAll();scheduleSave();return;
  }
  if(e.target.matches("[data-edit-prop]")&&node) {
    node.props[e.target.dataset.editProp]=e.target.value;renderItems();scheduleSave();return;
  }
  if(e.target.matches("[data-edit-prop-check]")&&node) {
    node.props[e.target.dataset.editPropCheck]=e.target.checked;renderAll();scheduleSave();return;
  }
  if(e.target.dataset.objectSlider) {
    const n=getSelected()[0];if(n){n.props[e.target.dataset.objectSlider]=Number(e.target.value);const el=itemLayer.querySelector('[data-item="'+n.id+'"] .object-state');if(el)el.textContent="Posição: "+e.target.value+"%";scheduleSave();}
  }
}


function bindUI() {
  document.querySelectorAll("[data-tool]").forEach((button)=>button.addEventListener("click",()=>{
    setTool(button.dataset.tool);
    if(button.dataset.tool==="object")setPanel("catalog");
    if(button.dataset.tool==="image"){fileTarget="image";}
  }));
  document.querySelectorAll("[data-panel]").forEach((button)=>button.addEventListener("click",()=>setPanel(button.dataset.panel)));
  itemLayer.addEventListener("pointerdown",(e)=>{});
  itemLayer.addEventListener("click",itemClick);
  inspectorContent.addEventListener("click",inspectorClick);
  inspectorContent.addEventListener("input",inspectorInput);
  inspectorContent.addEventListener("change",(e)=>{
    inspectorInput(e);
    if(e.target.matches("[data-volume]")){boardState.settings.audio[e.target.dataset.volume]=Number(e.target.value);scheduleSave();}
  });
  viewport.addEventListener("pointerdown",pointerDown);
  viewport.addEventListener("pointermove",pointerMove);
  viewport.addEventListener("pointerup",pointerUp);
  viewport.addEventListener("pointercancel",pointerUp);
  viewport.addEventListener("contextmenu",(e)=>e.preventDefault());
  viewport.addEventListener("wheel",(e)=>{
    e.preventDefault();
    const old=zoom,delta=e.deltaY<0?1.1:.91;
    zoom=clamp(zoom*delta,.2,3);
    const rect=viewport.getBoundingClientRect(),sx=e.clientX-rect.left,sy=e.clientY-rect.top;
    tx=sx-(sx-tx)*(zoom/old);ty=sy-(sy-ty)*(zoom/old);
    updateTransform();
  },{passive:false});
  viewport.addEventListener("dragover",(e)=>{e.preventDefault();viewport.style.outline="2px dashed #e5be74";});
  viewport.addEventListener("dragleave",()=>viewport.style.outline="");
  viewport.addEventListener("drop",(e)=>{
    e.preventDefault();viewport.style.outline="";
    Array.from(e.dataTransfer.files||[]).forEach(addImageFromFile);
  });
  $("file-input").addEventListener("change",(e)=>{
    Array.from(e.target.files||[]).forEach(addImageFromFile);e.target.value="";
  });
  $("audio-input").addEventListener("change",(e)=>{
    Array.from(e.target.files||[]).forEach((file)=>addImageFromFile(file));e.target.value="";
  });
  $("json-input").addEventListener("change",(e)=>{
    if(e.target.files&&e.target.files[0])importJSONFile(e.target.files[0],e.target.dataset.gm==="true");
    e.target.value="";
  });

  $("add-document").addEventListener("click",()=>addNode("document"));
  $("add-note").addEventListener("click",()=>addNode("note"));
  $("add-map").addEventListener("click",()=>{fileTarget="map";$("file-input").click();});
  $("add-book").addEventListener("click",()=>addNode("book"));
  $("add-object").addEventListener("click",()=>setPanel("catalog"));
  $("zoom-in").addEventListener("click",()=>zoomAt(viewport.clientWidth/2,viewport.clientHeight/2,1.15));
  $("zoom-out").addEventListener("click",()=>zoomAt(viewport.clientWidth/2,viewport.clientHeight/2,1/1.15));
  $("fit-board").addEventListener("click",frameBoard);
  $("more-board").addEventListener("click",()=>{
    openModal("Mais ferramentas",'<div class="catalog-grid"><button class="catalog-card" data-more="import-library"><span class="art">▧</span><span><b>Biblioteca Owlbear</b><small>Importar imagens da biblioteca da sala.</small></span></button><button class="catalog-card" data-more="audio"><span class="art">♫</span><span><b>Adicionar áudio</b><small>Inserir gravação no dossiê.</small></span></button><button class="catalog-card" data-more="help"><span class="art">?</span><span><b>Ajuda</b><small>Atalhos e manual de campo.</small></span></button><button class="catalog-card" data-more="new"><span class="art">＋</span><span><b>Novo caso</b><small>Criar um quadro separado.</small></span></button></div>',[{label:"Fechar",action:closeModal}]);
    $("modal-body").addEventListener("click",(e)=>{
      const b=e.target.closest("[data-more]");if(!b)return;
      const act=b.dataset.more;closeModal();
      if(act==="import-library")importOwlbearImages();
      if(act==="audio")$("audio-input").click();
      if(act==="help")showHelp();
      if(act==="new")createBoardEntry();
    });
  });
  $("undo-btn").addEventListener("click",undo);
  $("redo-btn").addEventListener("click",redo);
  $("archive-btn").addEventListener("click",()=>{
    openModal("Arquivo do caso",'<p>Salve um backup, importe uma mesa ou comece um novo caso.</p><div class="panel-actions"><button class="btn" id="archive-export">Exportar JSON</button><button class="btn" id="archive-import">Importar JSON</button><button class="btn" id="archive-gm">Backup do mestre</button><button class="btn" id="archive-new">Novo quadro</button></div>',[{label:"Fechar",action:closeModal}]);
    $("modal-body").addEventListener("click",(e)=>{
      if(e.target.id==="archive-export"){closeModal();exportJSON(false);}
      if(e.target.id==="archive-import"){closeModal();$("json-input").dataset.gm="false";$("json-input").click();}
      if(e.target.id==="archive-gm"){closeModal();exportJSON(true);}
      if(e.target.id==="archive-new"){closeModal();createBoardEntry();}
    });
  });
  $("effects-btn").addEventListener("click",()=>setPanel("effects"));
  $("obs-btn").addEventListener("click",()=>{
    document.body.classList.toggle("obs-mode");
    document.body.classList.toggle("transparent",document.body.classList.contains("obs-mode")||boardState.surface==="transparent");
    toast(document.body.classList.contains("obs-mode")?"Modo OBS ativado. Pressione H para retornar.":"Interface restaurada.");
  });
  $("case-status").addEventListener("click",()=>{
    if(!isGM)return;
    const next={"CASO ABERTO":"EM ANÁLISE","EM ANÁLISE":"RESOLVIDO","RESOLVIDO":"CASO ABERTO"};
    boardState.status=next[boardState.status]||"CASO ABERTO";renderHeader();scheduleSave();
  });
  $("surface-select").addEventListener("change",(e)=>{
    boardState.surface=e.target.value;document.body.classList.toggle("transparent",e.target.value==="transparent"||document.body.classList.contains("obs-mode"));renderHeader();scheduleSave();
  });
  $("uv-toggle").addEventListener("change",(e)=>{boardState.settings.uv=e.target.checked;renderHeader();renderEffects();scheduleSave();});
  $("lamp-toggle").addEventListener("change",(e)=>{boardState.settings.lamp=e.target.checked;renderEffects();scheduleSave();});
  $("torch-toggle").addEventListener("change",(e)=>{boardState.settings.torch=e.target.checked;renderEffects();scheduleSave();});
  $("minimap-btn").addEventListener("click",toggleMinimap);
  $("mobile-inspector").addEventListener("click",()=>inspector.classList.toggle("open"));
  $("inspector-close").addEventListener("click",()=>inspector.classList.remove("open"));
  $("help-btn").addEventListener("click",showHelp);
  $("help-close").addEventListener("click",hideHelp);
  $("help-overlay").addEventListener("click",(e)=>{if(e.target.id==="help-overlay")hideHelp();});
  $("modal-close").addEventListener("click",closeModal);
  $("modal-backdrop").addEventListener("click",(e)=>{if(e.target.id==="modal-backdrop")closeModal();});
  $("sanity-widget").addEventListener("dblclick",()=>{
    openModal("Sanidade",'<div class="field"><label>Valor</label><input id="sanity-edit" type="number" min="0" max="100" value="'+boardState.settings.sanity.value+'"></div>',[
      {label:"Cancelar",action:closeModal},
      {label:"Aplicar",primary:true,action:()=>{
        boardState.settings.sanity.value=clamp(Number($("sanity-edit").value),0,100);closeModal();renderHeader();scheduleSave();
      }}
    ]);
  });
  $("viewport").addEventListener("pointermove",(e)=>{
    if(boardState.settings.torch||boardState.settings.light.mode==="torch") {
      const r=viewport.getBoundingClientRect();torchPoint={x:(e.clientX-r.left)/r.width*100,y:(e.clientY-r.top)/r.height*100};updateLight();
    }
  });
  $("mini-map").addEventListener("click",(e)=>{
    const r=e.currentTarget.getBoundingClientRect(),px=(e.clientX-r.left)/r.width,py=(e.clientY-r.top)/r.height;
    tx=viewport.clientWidth/2-px*5000*zoom;ty=viewport.clientHeight/2-py*4000*zoom;updateTransform();
  });
}
function zoomAt(screenX,screenY,factor) {
  const old=zoom;zoom=clamp(zoom*factor,.2,3);
  tx=screenX-(screenX-tx)*(zoom/old);ty=screenY-(screenY-ty)*(zoom/old);
  updateTransform();
}
function keyDown(e) {
  const typing=e.target && (["INPUT","TEXTAREA","SELECT"].includes(e.target.tagName)||e.target.isContentEditable);
  if(e.code==="Space"&&!typing){spaceDown=true;document.body.classList.add("space");e.preventDefault();return;}
  if(typing)return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){e.preventDefault();undo();return;}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="y"){e.preventDefault();redo();return;}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="d"){e.preventDefault();duplicateSelected();return;}
  if(e.key==="Delete"||e.key==="Backspace"){deleteSelected();return;}
  if(e.key==="0"){frameBoard();return;}
  if(e.key==="Escape"){setTool("select");hideLens();hideHelp();closeModal();return;}
  if(e.key==="["){setLayer("back");return;}
  if(e.key==="]"){setLayer("front");return;}
  const shortcuts={v:"select",p:"pin",f:"wire",n:"note",i:"image",c:"mark",t:"tape",r:"scratch",k:"object",l:"lens"};
  if(shortcuts[e.key.toLowerCase()]) {
    const tool=shortcuts[e.key.toLowerCase()];
    if(tool==="note")addNode("note");
    else if(tool==="image"){$("file-input").click();}
    else if(tool==="object")setPanel("catalog");
    else if(tool==="tape")addNode("tape");
    else if(tool==="scratch")addNode("scratch");
    else setTool(tool);
    return;
  }
  if(e.key.toLowerCase()==="m"){toggleMinimap();return;}
  if(e.key.toLowerCase()==="b"){boardState.settings.uv=!boardState.settings.uv;renderAll();scheduleSave();return;}
  if(e.key.toLowerCase()==="j"){boardState.settings.torch=!boardState.settings.torch;renderAll();scheduleSave();return;}
  if(e.key.toLowerCase()==="h"){$("obs-btn").click();return;}
}
function keyUp(e) {
  if(e.code==="Space"){spaceDown=false;document.body.classList.remove("space");}
}
async function loadSceneWorkspace() {
  if(!OBR_API||!sceneReady)return;
  try {
    const metadata=await OBR_API.scene.getMetadata();
    const incoming=metadata&&metadata[META_KEY];
    if(incoming&&incoming.version===3&&Array.isArray(incoming.boards)) {
      const local=workspace;
      workspace=normalizeWorkspace(incoming);
      if(isGM&&local) {
        workspace.boards.forEach((entry)=>{
          const localEntry=local.boards.find((b)=>b.id===entry.id);
          if(localEntry) {
            const privateNodes=(localEntry.data.nodes||[]).filter((n)=>n.gmOnly);
            const ids=new Set(entry.data.nodes.map((n)=>n.id));
            entry.data.nodes.push(...privateNodes.filter((n)=>!ids.has(n.id)));
            const privateWires=(localEntry.data.wires||[]).filter((w)=>{
              const a=localEntry.data.nodes.find((n)=>n.id===w.from.nodeId),b=localEntry.data.nodes.find((n)=>n.id===w.to.nodeId);
              return a&&b&&(a.gmOnly||b.gmOnly);
            });
            entry.data.wires.push(...privateWires);
          }
        });
      }
      bindActiveBoard();remoteTimestamp=incoming.updatedAt||0;
      try{localStorage.setItem(LOCAL_KEY,JSON.stringify(workspace));}catch(error){}
      $("connection").classList.add("connected");$("connection-text").textContent="Cena sincronizada";
      $("save-status").textContent="Mesa carregada da cena";
      renderAll();
    } else {
      $("connection-text").textContent="Cena pronta · salvando quadro";
      await persistNow();
    }
  } catch(error) {
    console.warn("Falha ao ler metadados da cena.",error);
    $("connection-text").textContent="Sem sincronização";
    toast("Não foi possível carregar o quadro compartilhado.");
  }
}
async function setupOwlbear() {
  try {
    if(!OBR_API || !OBR_API.isAvailable) {
      $("connection-text").textContent="Modo independente";
      return;
    }
    isOwlbear=true;
    OBR_API.onReady(async()=>{
      try {
        await OBR_API.action.setWidth(1600);
        await OBR_API.action.setHeight(1000);
      } catch(error) { console.info("O Owlbear manteve o tamanho padrão do painel.",error); }
      try {
        const role=await OBR_API.player.getRole();
        isGM=role==="GM";
        canEdit=isGM;
        roleName=isGM?"Mestre":"Jogador";
      } catch(error) {isGM=true;canEdit=true;}
      $("connection-text").textContent="Owlbear · conectado";
      sceneReady=await OBR_API.scene.isReady().catch(()=>false);
      if(sceneReady)await loadSceneWorkspace();
      else $("connection-text").textContent="Abra uma cena";
      OBR_API.scene.onReadyChange(async(ready)=>{
        sceneReady=ready;
        if(ready)await loadSceneWorkspace();
        else{$("connection").classList.remove("connected");$("connection-text").textContent="Sem cena ativa";$("save-status").textContent="Salvamento local";}
      });
      OBR_API.scene.onMetadataChange((metadata)=>{
        const incoming=metadata&&metadata[META_KEY];
        if(!incoming||incoming.writer===CLIENT_ID||Number(incoming.updatedAt||0)<=remoteTimestamp)return;
        remoteTimestamp=incoming.updatedAt;
        if(isGM) {
          const local=workspace;
          const remote=normalizeWorkspace(incoming);
          remote.boards.forEach((entry)=>{
            const localEntry=local.boards.find((b)=>b.id===entry.id);
            if(localEntry) {
              const privateNodes=(localEntry.data.nodes||[]).filter((n)=>n.gmOnly);
              const remoteIds=new Set(entry.data.nodes.map((n)=>n.id));
              entry.data.nodes.push(...privateNodes.filter((n)=>!remoteIds.has(n.id)));
            }
          });
          workspace=remote;
        } else workspace=normalizeWorkspace(incoming);
        bindActiveBoard();selectedIds=[];renderAll();
        try{localStorage.setItem(LOCAL_KEY,JSON.stringify(workspace));}catch(error){}
        toast("Quadro atualizado por outro participante.");
      });
    });
  } catch(error) {
    console.warn("SDK Owlbear indisponível.",error);
    $("connection-text").textContent="Modo independente";
  }
}
function applyStoredCamera() {
  if(boardState.camera) {
    tx=Number(boardState.camera.x)||0;
    ty=Number(boardState.camera.y)||0;
    zoom=clamp(Number(boardState.camera.zoom)||.72,.2,3);
    if(tx===0&&ty===0)frameBoard();else updateTransform();
  } else frameBoard();
}
function init() {
  loadLocal();
  bindUI();
  applyStoredCamera();
  renderAll();
  window.addEventListener("keydown",keyDown);
  window.addEventListener("keyup",keyUp);
  window.addEventListener("resize",()=>{renderMinimap();});
  document.addEventListener("visibilitychange",()=>{
    if(document.hidden){lastActivity=Date.now();stopAmbient();}
  });
  setupOwlbear();
  scheduleSave();
  if(!isOwlbear) {
    $("save-status").textContent="Salvamento local";
    $("connection-text").textContent="Modo independente";
  }
}
init();


function sendMasterRequest(action,nodeId,payload={}) {
  if(!OBR_API || !isOwlbear)return toast("Esta interação só pode ser compartilhada dentro de uma sala do Owlbear.");
  const data={kind:"qi-interaction",action:action,nodeId:nodeId,payload:payload,sentAt:Date.now()};
  OBR_API.broadcast.sendMessage(BROADCAST_CHANNEL,data).catch((error)=>toast("Não foi possível enviar a interação ao mestre."));
}
async function handleMasterRequest(event) {
  if(!isGM || !canEdit)return;
  const data=event&&event.data;
  if(!data||data.kind!=="qi-interaction")return;
  const node=getNode(data.nodeId);
  if(!node)return;
  let ok=true,message="Interação aplicada: "+data.action;
  switch(data.action) {
    case "safe-unlock":
      ok=await verifySecret(node,"code",data.payload&&data.payload.value);
      if(ok){remember();node.props.unlocked=true;node.props.objectState="open";node.props.message="O mecanismo cedeu. O cofre está aberto.";message="Cofre destrancado.";}
      else message="Combinação incorreta no cofre.";
      break;
    case "lockbox-unlock":
      ok=await verifySecret(node,"password",data.payload&&data.payload.value);
      if(ok){remember();node.props.unlocked=true;node.props.message="A maleta foi aberta.";message="Maleta aberta.";}
      else message="Senha incorreta na maleta.";
      break;
    case "radio-tune":
      ok=await verifySecret(node,"frequency",data.payload&&data.payload.value);
      if(ok){remember();node.props.objectState="on";node.props.display="SINAL ENCONTRADO";node.props.message="Uma voz começa a falar entre os ruídos.";message="O rádio encontrou o sinal.";}
      else message="O rádio recebeu uma frequência incorreta.";
      break;
    case "crystal-open":
      remember();node.props.visionRevealed=true;node.props.message=secretFor(node.id).vision||node.props.message;message="A visão da bola de cristal foi revelada.";break;
    case "tarot-draw":
      tarotDraw(node);message="Uma tiragem de tarô foi solicitada.";break;
    case "scale-test":
      remember();node.props.beam=Math.random()>.5?0:8;node.props.message=node.props.beam===0?"A pena e o coração estão em equilíbrio.":"O coração pesa mais que a pena.";break;
    case "ouija-open":
      remember();node.props.objectState="on";node.props.message=(data.payload&&data.payload.message)||node.props.message||"A prancheta se moveu.";message="Mensagem registrada na tábua.";break;
    case "music-toggle":case "pendulum-toggle":case "candle-toggle":case "incense-toggle":case "mirror-toggle":case "watch-toggle":case "vhs-toggle":case "tv-toggle":case "portal-toggle":case "switch-toggle":case "bulb-toggle":case "mask-toggle":case "wisp-toggle":
      remember();node.props.objectState=node.props.objectState==="on"?"idle":"on";break;
    case "emf-toggle":
      remember();{const v=Math.floor(Math.random()*6);node.props.display="NÍVEL "+v;node.props.message=v>=4?"Atividade paranormal elevada.":"Atividade fraca ou inexistente.";}break;
    case "thermometer-read":
      remember();{const v=(Math.random()*20-2).toFixed(1);node.props.display=v+" °C";node.props.message=Number(v)<5?"Queda brusca de temperatura.":"Temperatura dentro do esperado.";}break;
    case "cauldron-stir":
      remember();node.props.objectState="on";node.props.message="O caldeirão borbulha e um vapor violeta sobe.";break;
    case "skull-speak":
      node.props.message=secretFor(node.id).message||node.props.message;message=node.props.message;break;
    case "holy-water":case "key-use":case "coin-flip":case "wall-search":case "pouch-open":
      remember();node.props.objectState="on";node.props.message=data.action==="coin-flip"?(Math.random()>.5?"Cara":"Coroa"):"O objeto foi examinado.";break;
    case "tree-state":
      remember();node.props.treeState=node.props.treeState==="locked"?"available":node.props.treeState==="available"?"solved":"locked";break;
    case "timer-toggle":
      remember();node.props.objectState="on";node.props.message="O temporizador foi iniciado.";break;
    case "dial-turn":
      remember();node.props.position=((Number(node.props.position||0)+25)%100);break;
    case "trigger-toggle":
      remember();node.props.activated=!node.props.activated;break;
    default:
      return;
  }
  if(ok){renderAll();await persistNow();}
  if(OBR_API)OBR_API.broadcast.sendMessage(BROADCAST_CHANNEL,{kind:"qi-interaction-result",message:message,ok:ok},{destination:"REMOTE"}).catch(()=>{});
}
