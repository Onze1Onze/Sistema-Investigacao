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
  html='<h2>Colaboração da mesa</h2>';
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
