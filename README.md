# AirDraw Client — edição profissional

Esta versão mantém o MediaPipe Hand Landmarker e o envio de capturas para o servidor configurado em `config.js`.

## O que foi adicionado

- UI responsiva renovada, com dock rápido e painel recolhível.
- Cursor discreto em cruz, sem círculo sobre a mão.
- Estabilização: desligada, suave, média e forte.
- Pincéis sólido, marcador, neon e tracejado.
- Opacidade, cor personalizada e grossura de 1 a 50 px.
- Desfazer e refazer.
- Gestos: pinça para desenhar, dois dedos para desfazer e punho para borracha temporária.
- Seleção de câmera sem recriar o MediaPipe.
- Ocultar câmera sem parar a detecção.
- Espelhamento e tela cheia.
- FPS e latência na interface.
- Preferências salvas em `localStorage`.
- Capturas periódicas para o servidor e botão “Enviar agora”.

## Capturas para servidor

O endpoint continua sendo:

`POST /api/captures?session=<id-da-sessao>`

com corpo `image/jpeg`.

Configure em `config.js`:

```js
PHOTO_SERVER_URL: "https://SEU-SERVIDOR.vercel.app"
```

O envio periódico só é ativado quando o usuário marca a opção correspondente na entrada ou usa o botão de capturas dentro da interface.

## Vercel

Publique os arquivos da raiz com Framework Preset = Other. A câmera exige HTTPS em produção.
