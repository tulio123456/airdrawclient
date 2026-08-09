# AirDraw — Gesture Drawing Studio

Aplicação web de desenho no ar com câmera + MediaPipe Hand Landmarker.

## O que esta versão inclui

- desenho por pinça (polegar + indicador);
- cursor estabilizado e 4 níveis de suavização;
- mão aberta para pausa/menu radial;
- punho fechado como borracha temporária;
- dois dedos para desfazer com cooldown;
- menu radial por gesto;
- suporte a até duas mãos e escolha da mão de desenho;
- zoom com duas mãos e modo de navegação;
- pincéis: sólido, marcador, neon, glow, spray, pontilhado, tracejado, laser e arco-íris;
- opacidade e espessura de 1 a 50 px;
- formas geométricas e correção simples de círculo;
- câmera selecionável, espelhamento, qualidade e ocultação visual sem desligar o tracking;
- fundos: câmera, câmera escurecida, preto, branco e transparente;
- salvar PNG com ou sem câmera;
- salvar/carregar projeto local em JSON;
- gravação do processo com MediaRecorder;
- timelapse do histórico de ações;
- galeria da sessão;
- painel de FPS, confiança, número de mãos e latência;
- calibração guiada;
- preferências em localStorage;
- guia leve de enquadramento do rosto para melhorar a experiência.

## Privacidade

A câmera é processada localmente no navegador. Esta versão não envia frames para servidor e não salva fotografias automaticamente. Captura de foto e gravação só começam por ação explícita do usuário.

## Estrutura

- `index.html` — interface
- `styles.css` — layout responsivo
- `app.js` — pipeline principal, câmera, MediaPipe e integração
- `js/drawing.js` — Canvas, pincéis, histórico e formas
- `js/gestures.js` — classificação de gestos, suavização e cooldown
- `js/recorder.js` — gravação e timelapse
- `js/storage.js` — localStorage e downloads locais
- `config.js` — flags locais
- `vercel.json` — configuração para Vercel

## Vercel

Publique os arquivos na raiz do repositório e use Framework Preset = Other. A Vercel fornece HTTPS, necessário para APIs de câmera em navegadores modernos.

## Observação

O Hand Landmarker continua sendo o recurso principal. O guia de rosto é auxiliar e funciona em frequência reduzida; se ele não estiver disponível, o desenho com as mãos continua funcionando.
