const SHEET_ID = '1aTTkxj3R9zFLDdTTIuCL0-C0EpN5ek8tbWUczC5PdQY';
const GID = '0';
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\r') {
      // skip
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const LOWER_WORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'em', 'com', 'para', 'no', 'na', 'à', 'ao', 'aos']);

function toTitleCase(str) {
  const words = str.toLowerCase().split(/\s+/).filter(Boolean);
  return words.map((w, i) => {
    const bare = w.replace(/^[^a-zà-öø-ÿ]+/i, '');
    if (i > 0 && LOWER_WORDS.has(bare)) return w;
    return w.split('-').map(part => part.replace(/[a-zà-öø-ÿ]/i, c => c.toUpperCase())).join('-');
  }).join(' ');
}

const PROPER = { pix: 'Pix', tea: 'TEA', tdah: 'TDAH', instagram: 'Instagram', whatsapp: 'WhatsApp' };

function toSentenceCase(line) {
  let s = line.toLowerCase().trim();
  s = s.replace(/r\$/g, 'R$');
  s = s.replace(/\b(pix|tea|tdah|instagram|whatsapp)\b/gi, (m) => PROPER[m.toLowerCase()]);
  s = s.replace(/(^\s*[a-zà-ú])|([.!?]\s+[a-zà-ú])|(:\s*[a-zà-ú])/gi, (m) => m.toUpperCase());
  return s.trim();
}

function normCell(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

// remove sufixo com o nome do responsável, ex: "Empresa (Fulano)" ou "Empresa - Fulano"
function stripOwnerSuffix(nome) {
  return nome
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/\s+[-–—]\s+\S.*$/, '')
    .trim();
}

// \b do JS não reconhece corretamente limite de palavra ao lado de vogais acentuadas
// (ex: "\bá vista\b" nunca casa) — por isso usamos lookaround como substituto.
function wordBoundaryRegex(phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![a-zà-öø-ÿ])${escaped}(?![a-zà-öø-ÿ])`, 'gi');
}

// erros recorrentes de PT-BR/digitação encontrados na planilha (aplicados no texto já formatado)
const PT_BR_FIXES = [
  ['a vista', 'à vista'],
  ['á vista', 'à vista'],
  ['debíto', 'débito'],
  ['domicilio', 'domicílio'],
  ['à domicílio', 'a domicílio'], // "domicílio" é masculino, não tem crase
  ['fonoaudiologa', 'fonoaudiológica'],
  ['presencial6', 'presencial 6'],
  ['Rejoaleria', 'Rejoalheria'],
  ['brasil card', 'Brasil Card'],
  ['kr dental', 'KR Dental'],
  ['agência era', 'Agência ERA'],
].map(([find, fix]) => [wordBoundaryRegex(find), fix]);

function applyPtBrFixes(str) {
  return PT_BR_FIXES.reduce((s, [pattern, fix]) => s.replace(pattern, fix), str);
}

// linhas da célula de BENEFÍCIO às vezes são só quebra visual, não um novo item da lista.
// junta a linha com a anterior quando ela é claramente uma continuação da frase.
const DANGLING_WORDS = new Set(['para', 'com', 'de', 'em', 'e', 'ou', 'no', 'na', 'a', 'à', 'sem', 'por', 'que', 'do', 'da', 'dos', 'das', 'ao', 'aos']);

function endsWithDangling(text) {
  const m = text.trim().match(/([a-zà-öø-ÿ]+)$/i);
  return !!m && DANGLING_WORDS.has(m[1].toLowerCase());
}

function startsWithDangling(text) {
  const m = text.trim().match(/^([a-zà-öø-ÿ]+)\b/i);
  return !!m && DANGLING_WORDS.has(m[1].toLowerCase());
}

function parenBalance(text) {
  let bal = 0;
  for (const c of text) { if (c === '(') bal++; else if (c === ')') bal--; }
  return bal;
}

function mergeBulletLines(lines) {
  const bullets = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const prev = bullets[bullets.length - 1];
    const continues = prev !== undefined && (
      line.startsWith('(') || parenBalance(prev) > 0 || endsWithDangling(prev) || startsWithDangling(line) || /[,;]\s*$/.test(prev)
    );
    if (continues) {
      bullets[bullets.length - 1] = `${prev} ${line}`;
    } else {
      bullets.push(line);
    }
  }
  return bullets;
}

function contatoFromCell(contatoCell) {
  if (!contatoCell) return null;
  const lines = contatoCell.split('\n').map(s => s.trim()).filter(Boolean);
  const digits = (lines[0] || '').replace(/\D/g, '');
  if (!digits) return null;
  const label = lines[1] ? toTitleCase(lines[1]) : '';
  return label ? `${digits}|${label}` : digits;
}

function sheetRowsToParceiros(csvText) {
  const rows = parseCSV(csvText);
  const headerIdx = rows.findIndex(r => (r[0] || '').trim().toUpperCase() === 'NOME DA EMPRESA');
  const dataRows = headerIdx >= 0 ? rows.slice(headerIdx + 1) : rows;

  const parceiros = [];
  for (const r of dataRows) {
    const nomeRaw = normCell(r[0]);
    const ramoRaw = normCell(r[1]);
    const beneficioRaw = (r[2] || '').trim();
    const contatos = [contatoFromCell(r[4]), contatoFromCell(r[6])].filter(Boolean);

    // só entra na lista quando o cadastro está completo
    if (!nomeRaw || !ramoRaw || !beneficioRaw || contatos.length === 0) continue;

    const nome = applyPtBrFixes(toTitleCase(stripOwnerSuffix(nomeRaw)));
    const ramo = applyPtBrFixes(toTitleCase(ramoRaw));
    const beneficio = mergeBulletLines(beneficioRaw.split('\n'))
      .map(toSentenceCase)
      .map(applyPtBrFixes)
      .join('\n');

    parceiros.push({ nome, ramo, beneficio, contatos });
  }
  return parceiros;
}

module.exports = async (req, res) => {
  try {
    const resp = await fetch(CSV_URL);
    if (!resp.ok) throw new Error(`Falha ao buscar planilha (HTTP ${resp.status})`);
    const csvText = await resp.text();
    const parceiros = sheetRowsToParceiros(csvText);

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json(parceiros);
  } catch (err) {
    res.status(502).json({ error: 'Não foi possível carregar os parceiros agora.' });
  }
};
