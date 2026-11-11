# Quadro Investigativo · Owlbear Rodeo

Extensão de mesa investigativa para campanhas de RPG. O quadro é uma aplicação própria construída a partir da interface e dos estilos fornecidos como referência.

## Instalação

Adicione o endereço do manifesto como extensão personalizada no Owlbear Rodeo:

**https://rawcdn.githack.com/Onze1Onze/Sistema-Investigacao/main/manifest.json**

O manifesto aponta para uma revisão imutável da interface e dos arquivos estáticos. A página HTML é entregue com `Content-Type: text/html`; não usar jsDelivr para servir `index.html`, pois esse CDN pode entregá-lo como texto simples.

## Funcionalidades implementadas

### Mesa e edição
- Área de trabalho ampla com pan, zoom, enquadramento e minimapa.
- Seleção múltipla, movimentação de itens, inércia, colisão/repulsão simples, rotação e redimensionamento.
- Pins em itens e conexões curvas por fios; marcações livres, setas, círculos, caixas e linhas.
- Documentos, folhas, post-its, fichas, imagens, mapas, PDFs, áudios, vídeos e fitas adesivas.
- Raspadinhas e segredos reveláveis por luz negra.
- Cadernos com páginas, colagens de imagem e extração de folhas.
- Desfazer/refazer, duplicar, ordenar camadas, exportar PNG, exportar/importar JSON e backup de mestre.

### Biblioteca de objetos e enigmas
A biblioteca inclui cofres, maletas com senha, rádio de emergência, bola de cristal, tarô, balança de Anúbis, Ouija, caixa de música, pêndulo, medidor EMF, termômetro, vela, incenso, caldeirão, crânio falante, espelhos, água benta, relógios, ampulheta, timer, VHS, TV, portal, máscara, fogo-fátuo, gato, ankh, discos de hieróglifos, parede de tijolos, saquinho de ervas, ativadores, árvore de pistas, múmia, mesa de luz e bandeja/temporizador de revelação.

Cofres, maletas e rádios verificam valores configurados pelo mestre. As credenciais ficam no armazenamento privado local do mestre; a sala recebe apenas hashes de verificação. Quando um jogador tenta resolver um mecanismo, a tentativa é enviada pelo canal de transmissão do Owlbear e o mestre valida e publica o resultado na cena.

### Atmosfera e apresentação
- Luz ambiente, luminária, lanterna, luz negra e revelação de texto secreto.
- Névoa, cinzas, teias, morcegos, Lua de Sangue, olhos no escuro, fogo-fátuo, máscara, chuva, neve, brasas, ectoplasma e fumaça.
- Barra de sanidade, volumes de áudio e ambientes sonoros gerados no navegador.
- Texturas de madeira, cortiça, feltro, mesa escura e fundo transparente.
- Modo OBS, com a interface escondida e somente o quadro visível.
- Incorporação de links de vídeo do YouTube em cartões de evidência.

- Barra contextual ao selecionar evidências: virar, ordenar camadas, adicionar pins, duplicar, excluir e enviar itens para mão/bolso.
- Pins podem ser ocultados em conjunto; painéis laterais podem ser minimizados.
- Pesquisa global de evidências no quadro.
- Rolador de dados com expressões, vantagem/desvantagem e compartilhamento de resultados.
- Anotações pessoais privadas por dispositivo; inventário de mão e bolso não altera o quadro compartilhado.
- Interações por arraste entre objetos compatíveis: chave em fechadura, moeda na balança, água benta no espelho, ankh em portal e ervas no caldeirão.

### Colaboração
- Múltiplos quadros/abas, com importação e exportação.
- Persistência por metadados da cena do Owlbear, separando itens exclusivos do mestre dos dados públicos.
- Cor e nome do jogador, além da preferência de sincronização de visão.
- Jogadores podem interagir com mecanismos sem receber as senhas em texto aberto.

## Arquivos

- `manifest.json`: entrada da extensão.
- `index.html`: estrutura da interface.
- `style.css`: tema Arquivo de Campo e estilos responsivos.
- `app.js`: estado, edição, objetos, enigmas, efeitos, importação/exportação e integração com o SDK.
- `icon.svg`: ícone da extensão.
- `.github/workflows/validate.yml`: validação de sintaxe e disponibilidade dos arquivos publicados.

## Sobre os arquivos de referência enviados

O pacote enviado continha o HTML, quatro folhas CSS (base e três camadas Halloween) e fontes WOFF2. O HTML referenciava cinco módulos JavaScript externos — `base.js`, `Halloween2026-1.js`, `Halloween2026-2.js`, `Halloween2026-3.js` e `base-fim.js` — que não vieram anexados. Por isso, a implementação do comportamento foi reconstruída em `app.js` a partir dos elementos e recursos identificáveis no HTML/CSS, sem copiar o JavaScript ausente. A nova interface utiliza famílias tipográficas equivalentes do Google Fonts; os arquivos WOFF2 originais foram inventariados, mas não incorporados como binários neste repositório.

## Limites conhecidos

- A física é de interface (inércia e repulsão simples), não um motor físico completo.
- A névoa desenhada nos mapas é uma camada do quadro investigativo, independente do sistema nativo de Fog do Owlbear.
- Os ambientes sonoros são sintetizados pelo navegador; não acompanham a biblioteca de áudios do projeto original.
- O estado compartilhado utiliza metadados da cena. Imagens são comprimidas antes de entrar no estado; arquivos muito grandes devem ser reduzidos ou ligados por URL.
- O teste automatizado verifica a sintaxe e a entrega dos arquivos públicos. A validação final de experiência deve ser feita numa sala real do Owlbear com mestre e jogadores.

## Desenvolvimento

Aplicação estática sem etapa de build. O módulo importa `@owlbear-rodeo/sdk@3.1.0` como ESM. O GitHub Actions verifica o JSON do manifesto, a sintaxe do módulo, a resposta HTTP e os arquivos CSS/JS publicados.

## Licenças

A implementação deste repositório é própria. O SDK do Owlbear Rodeo mantém sua licença original. As famílias de fontes carregadas remotamente permanecem sob as respectivas licenças dos fornecedores.
