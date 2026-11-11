# Quadro Investigativo — Owlbear Rodeo

Extensão para montar um mural investigativo colaborativo dentro do Owlbear Rodeo.

## Instalação

1. Abra a página de extensões do seu perfil no Owlbear Rodeo.
2. Escolha **Adicionar extensão** e depois **Adicionar extensão personalizada**.
3. Cole o endereço do manifesto:

   https://cdn.jsdelivr.net/gh/Onze1Onze/Sistema-Investigacao@main/manifest.json

4. Adicione a extensão à sala e abra o ícone **Quadro Investigativo** no canto superior.

## Funcionalidades incluídas

- Mesa ampla com pan, zoom, enquadramento e minimapa.
- Cartões para documentos, notas, objetos, imagens, PDFs e gravações de áudio.
- Upload por seletor de arquivos ou arrastar e soltar.
- Pins em documentos e objetos; fios conectáveis entre dois pins.
- Arraste com inércia, curvas elásticas nos fios e repulsão simples entre cartões.
- Edição de título, descrição e rótulo; duplicar e remover evidências.
- Histórico de desfazer/refazer.
- Luz ambiente, luminária, lanterna de cursor, luz negra e escurecimento.
- Registro de frequências, fitas e objetos especiais.
- Importação/exportação do quadro em JSON.
- Persistência local fora do Owlbear e sincronização via metadados da cena quando há uma cena aberta.

## Arquitetura e compatibilidade

A extensão usa o SDK oficial `@owlbear-rodeo/sdk@3.1.0` carregado como módulo ESM. A interface é servida como HTML/CSS/JavaScript sem etapa de build. O manifesto segue o formato de extensão documentado pelo Owlbear Rodeo (`manifest_version: 1`).

Os dados compartilhados são gravados em `OBR.scene.setMetadata` com chave namespaced `com.onze1onze.sistemainvestigacao/board`. O armazenamento de metadados da sala não é usado para o quadro, porque a documentação oficial limita esse espaço a 16 KB.

As imagens selecionadas são redimensionadas e recomprimidas antes de entrar no estado da mesa. PDFs e áudios grandes são recusados para evitar criar metadados excessivamente pesados; use arquivos compactados ou links externos nesses casos. O suporte a arquivos é limitado ao conteúdo que o browser consegue ler.

O botão de tela cheia tenta usar a Fullscreen API do navegador. O Owlbear controla o tamanho externo do popover, então o navegador pode limitar a expansão à área que o host permitir.

## Observação sobre a referência visual

O quadro Hips & Hops foi analisado pela interface pública renderizada e seus controles visíveis. O código-fonte interno do site não estava exposto como repositório ou arquivo público acessível no endereço consultado; esta extensão é uma implementação independente das funcionalidades observáveis, não uma cópia do código proprietário.

## Desenvolvimento

Não há dependências de build. Para servir localmente, use qualquer servidor estático e instale no Owlbear o manifesto local apontado pelo servidor. O SDK é importado do CDN ESM durante a execução.

## Licença

Este repositório contém implementação original. O SDK do Owlbear Rodeo é distribuído separadamente sob sua própria licença MIT.
