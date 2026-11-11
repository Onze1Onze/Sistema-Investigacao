import OBR from "https://esm.sh/@owlbear-rodeo/sdk@3.1.0";

const APP_ID = "com.onze1onze.sistemainvestigacao";
const META_KEY = APP_ID + "/workspace-v3";
const LOCAL_KEY = "sai-investigation-workspace-v3";
const PRIVATE_KEY = "sai-investigation-private-v1";
const CLIENT_ID = "sai-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
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
function itemClasses(node) {
  const classes=["item"];
  if (selectedIds.includes(node.id)) classes.push("selected");
  if (node.type==="document" || node.type==="pdf" || node.type==="leaf") classes.push("paper");
  if (node.type==="note") classes.push(node.props.noteStyle==="ficha"?"note-ficha":node.props.noteStyle==="free"?"note-free":"note-postit");
  if (node.type==="image") classes.push("image-node");
  if (node.type==="map") classes.push("map-node");
  if (node.type==="object") {
    classes.push("object-node");
    if (node.props.objectType==="vampireMirror" || node.props.objectType==="mirror") classes.push("object-vampire");
    if (node.props.objectType==="tree") classes.push("tree-"+(node.props.treeState||"locked"));
  }
  if (node.type==="tape") classes.push("tape-node");
  if (node.type==="gmOnly") classes.push("gm-hidden");
  if (node.uvSecret) classes.push("uv-hidden");
  if (node.locked) classes.push("locked");
  return classes.join(" ");
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
function setPanel(panel) {
  currentPanel=panel;
  document.querySelectorAll("[data-panel]").forEach((button)=>button.classList.toggle("active",button.dataset.panel===panel));
  renderInspector();
}
function field(label,html) { return '<div class="field"><label>'+label+'</label>'+html+'</div>'; }
function renderInspector() {
  document.querySelectorAll("[data-panel]").forEach((button)=>button.classList.toggle("active",button.dataset.panel===currentPanel));
  if (currentPanel==="catalog") return renderCatalog();
  if (currentPanel==="effects") return renderEffectsPanel();
  if (currentPanel==="boards") return renderBoardsPanel();
  if (currentPanel==="share") return renderSharePanel();
  return renderProperties();
}
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
      if(await verifySecret(node,"code",value)){remember();node.props.unlocked=true;node.props.objectState="open";node.props.message="O mecanismo cedeu. O cofre está aberto.";closeModal();renderAll();scheduleSave();toast("Cofre destrancado.");}
      else toast("Combinação incorreta. O mecanismo permanece travado.");
    }}]);
}
function showLockPuzzle(node) {
  openModal("Senha da maleta",'<p>Digite a senha para liberar as travas.</p><input id="lock-password" type="password" autocomplete="off" placeholder="Senha da maleta" style="font:700 18px var(--typewriter);letter-spacing:.14em;text-align:center">',[{label:"Cancelar",action:closeModal},{label:"Abrir maleta",primary:true,action:async()=>{
    const val=$("lock-password").value;
    if(await verifySecret(node,"password",val)){remember();node.props.unlocked=true;node.props.message="A maleta foi aberta.";closeModal();renderAll();scheduleSave();toast("Maleta aberta.");}
    else toast("Senha incorreta.");
  }}]);
}
function showRadioPuzzle(node) {
  openModal("Sintonizar rádio",'<p>Gire o seletor até encontrar a frequência correta.</p><div class="radio-dial"><input id="radio-frequency" type="number" min="80" max="180" step=".01" value="100.00" style="font:700 25px ui-monospace;text-align:center"><span>MHz</span></div><p id="radio-feedback" class="help">O chiado aumenta quando você se aproxima do sinal.</p>',[
    {label:"Fechar",action:closeModal},
    {label:"Sintonizar",primary:true,action:async()=>{
      const val=Number($("radio-frequency").value).toFixed(2);
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
  if(!canEdit && isGM===false && !["safe-open","lock-open","radio-tune","crystal-open","tarot-draw","ouija-open"].includes(action))return toast("Este objeto está em modo de consulta.");
  if(!node) return;
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
