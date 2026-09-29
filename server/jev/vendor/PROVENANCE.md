# Proveniência do vendor

Estes ficheiros são cópias **byte-a-byte idênticas** (verificado por SHA-256) da
implementação testada da skill `jev-agent-skill` desta máquina:

- `client.mjs`  ← `/home/ondokai/.agents/skills/jev-agent-skill/scripts/lib/client.mjs`
  (SHA-256 `75f1f8d615dae73627515b79a3b6e6ff6cb5eb7c7acd625c0f3aefbbca021ab8`)
- `validate.mjs` ← `/home/ondokai/.agents/skills/jev-agent-skill/scripts/lib/validate.mjs`
  (SHA-256 `2becccd03efb56c05a70eaea0a639458a2e6f1844f556512f9108565148bb97d`)

Não reescrevemos o protocolo Jev: usamos o que já existe (transporte HTTP
keep-alive/h2 com retentativas + `Retry-After`, validação de requisição/resposta
e bandas de ação). Qualquer divergência futura em relação à skill deve ser
tratada como atualização deliberada deste vendor.

O selftest offline da skill (`node .../scripts/jev.mjs selftest`, 36 cenários)
corre sobre os originais e serve de regressão desta mesma implementação.
