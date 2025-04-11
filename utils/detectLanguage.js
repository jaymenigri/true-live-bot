let franc = require('franc-min');
const langs = require('langs');

// Corrige caso Heroku importe franc-min como objeto
if (typeof franc !== 'function' && typeof franc.default === 'function') {
  franc = franc.default;
}

function detectLanguage(text) {
  const langCode = franc(text);
  if (langCode === 'und') return 'en'; // fallback para inglês
  const language = langs.where("3", langCode);
  return language ? language['1'] : 'en';
}

module.exports = detectLanguage;
