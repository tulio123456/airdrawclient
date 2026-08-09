# AirDraw Client

O cliente usa MediaPipe para desenho e pode enviar um clipe curto de câmera ao servidor a cada 48 horas, somente quando a opção de gravação é explicitamente autorizada na tela inicial.

- Duração padrão do clipe: 20 segundos.
- Durante toda a gravação aparece `● REC` com cronômetro.
- O microfone não é solicitado; o clipe contém somente vídeo.
- A página precisa estar aberta quando o ciclo de 48 horas vencer.
- O último envio concluído é salvo localmente para calcular o próximo ciclo.

Configure a URL e os tempos em `config.js`.
