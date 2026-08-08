# AirDraw Client FINAL

Esta versão usa a API atual do MediaPipe Hand Landmarker (`@mediapipe/tasks-vision`).

## Importante

O desenho funciona mesmo que o servidor de fotos esteja fora do ar ou mal configurado.

## Configurar servidor

Em `config.js`:

```js
PHOTO_SERVER_URL: "https://SEU-SERVIDOR.vercel.app"
```

Use a URL do projeto `airdraw-server`.

## Vercel

Suba estes arquivos na raiz de um repositório e importe na Vercel com Framework Preset = Other.

Depois que o Client estiver publicado, copie a URL dele para a variável
`ALLOWED_ORIGINS` do Server.
