# AirDraw Client

Cliente do AirDraw com desenho gestual, detecção de rosto e gravações contínuas em clipes enquanto o site está aberto.

- A gravação inicia logo após a autorização/inicialização do AirDraw.
- Não existe intervalo de 48 horas nem cooldown entre clipes.
- Ao terminar e enviar um clipe, o próximo começa quase imediatamente.
- Durante a gravação existe um indicador `● REC` discreto.
- Os clipes são enviados em blocos pequenos e também tentam upload completo ao finalizar.
- Se a página sair durante um clipe, os blocos já enviados podem ser finalizados pelo servidor.

## Storage externo (Cloudflare R2)

Este Client não precisa receber nenhuma chave do Cloudflare. Ele continua enviando para `SERVER_URL`; a versão R2 do AirDraw Server encaminha e armazena as mídias no bucket privado do Cloudflare R2.
