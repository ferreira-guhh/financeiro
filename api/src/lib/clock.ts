/**
 * "Hoje" do ponto de vista do usuário (datas contábeis não têm hora).
 * APP_FIXED_DATE congela o relógio — usado em testes e demonstrações.
 */
export function today(): string {
  const fixed = process.env.APP_FIXED_DATE;
  if (fixed) return fixed;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.APP_TIMEZONE ?? 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
