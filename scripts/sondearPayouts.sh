#!/usr/bin/env bash
# Le pregunta a la API de Stripe, país por país, si puede pagar ahí.
#
# Es la ÚNICA fuente fiable. La documentación se quedó corta (no lista Argentina ni Colombia,
# que sí cobran por wire) y `bank_account_spec` se pasa de largo (devuelve formato para países
# a los que no se puede pagar). Aquí se crea un destinatario de prueba en el sandbox y se lee
# el estado real de sus capacidades:
#
#   unsupported → no existe la ruta. NO se puede pagar.
#   restricted  → existe, faltan datos del destinatario. SÍ se puede pagar.
#   active      → lista.
set -u
SCR="C:/Users/luis/AppData/Local/Temp/claude/c--Users-luis-red-social-mvp/5e4fdb3d-1475-4b4d-b410-7483b9c3790b/scratchpad"
cd "c:/Users/luis/red-social-mvp"
K=$(npx firebase functions:secrets:access STRIPE_PAYOUTS_SECRET_KEY 2>/dev/null | tr -d '\r\n')
OUT="$SCR/sondeo.tsv"
echo -e "pais\tlocal\twire" > "$OUT"

PAISES="$1"
for P in $PAISES; do
  R=$(curl -s -X POST https://api.stripe.com/v2/core/accounts \
    -H "Authorization: Bearer $K" -H "Stripe-Version: 2026-08-26.preview" \
    -H "Content-Type: application/json" \
    -d "{\"identity\":{\"country\":\"$P\",\"entity_type\":\"individual\"},\"contact_email\":\"sondeo-$P@vibraon.com\",\"display_name\":\"Sondeo $P\",\"configuration\":{\"recipient\":{\"capabilities\":{\"bank_accounts\":{\"local\":{\"requested\":true},\"wire\":{\"requested\":true}}}}},\"include\":[\"configuration.recipient\"]}")
  echo "$R" | node -e "
    let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
      let l='error', w='error';
      try {
        const j=JSON.parse(d);
        if (j.error) { l=w='ERROR:'+(j.error.code||j.error.type||'?'); }
        else { const b=j.configuration?.recipient?.capabilities?.bank_accounts||{};
               l=b.local?.status||'-'; w=b.wire?.status||'-'; }
      } catch(e) {}
      console.log('$P\t'+l+'\t'+w);
    });" >> "$OUT"
  sleep 0.3
done
echo "sondeados: $(( $(wc -l < "$OUT") - 1 ))"
