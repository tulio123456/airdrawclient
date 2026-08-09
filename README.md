# AirDraw Client

Cliente do AirDraw com desenho gestual, detecção de rosto e gravações contínuas em clipes enquanto o site está aberto.

- A gravação inicia logo após a autorização/inicialização do AirDraw.
- Não existe intervalo de 48 horas nem cooldown entre clipes.
- Ao terminar e enviar um clipe, o próximo começa quase imediatamente.
- Durante a gravação existe um indicador `● REC` discreto.
- Os clipes são enviados em blocos pequenos e também tentam upload completo ao finalizar.
- Se a página sair durante um clipe, os blocos já enviados podem ser finalizados pelo servidor.
