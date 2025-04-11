const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const dotenv = require('dotenv');
const bodyParser = require('body-parser');
const detectLanguage = require('./utils/detectLanguage');
const knowledgeBase = require('./knowledge-base.json');

dotenv.config();

// Firebase
const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Base de conhecimento
function findAnswerInKnowledgeBase(message) {
  const lower = message.toLowerCase().trim();
  const fact = knowledgeBase.facts.find(f => lower.includes(f.question.toLowerCase()));
  return fact ? { answer: fact.answer, source: fact.source } : null;
}

// NewsAPI
async function fetchRecentNews(query) {
  try {
    const response = await axios.get('https://newsapi.org/v2/everything', {
      params: {
        q: query || 'Israel',
        apiKey: process.env.NEWSAPI_KEY,
        sortBy: 'publishedAt',
        pageSize: 1,
        from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      }
    });

    const articles = response.data.articles;
    if (articles.length > 0) {
      const a = articles[0];
      return `🗞️ Notícia recente: *${a.title}* (${a.source.name}, ${new Date(a.publishedAt).toLocaleDateString()})`;
    }

    return "Nenhuma notícia recente foi encontrada.";
  } catch (error) {
    console.error('Erro ao buscar notícias:', error.message);
    return "Erro ao buscar notícias.";
  }
}

// Webhook do WhatsApp via Twilio
app.post('/webhook', async (req, res) => {
  console.log("📨 Webhook acionado! Mensagem recebida:", req.body);

  const from = req.body.From;
  const message = req.body.Body;

  if (!from || !message) {
    return res.send("Mensagem inválida.");
  }

  const userRef = db.collection('conversations').doc(from);
  const userDoc = await userRef.get();
  let history = userDoc.exists ? userDoc.data().messages : [];

  history.push({ role: 'user', content: message, timestamp: Date.now() });

  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  history = history.filter(m => m.timestamp > thirtyDaysAgo);

  if (history.length === 1) {
    const welcome = "Olá! Eu sou o *True Live*, seu mentor digital pró-Israel. Como posso ajudar você hoje?";
    history.push({ role: 'assistant', content: welcome, timestamp: Date.now() });
    await userRef.set({ messages: history });
    return res.send(welcome);
  }

  const lower = message.toLowerCase();
  if (lower.includes("últimas notícias")) {
    const newsReply = await fetchRecentNews();
    history.push({ role: 'assistant', content: newsReply, timestamp: Date.now() });
    await userRef.set({ messages: history });
    return res.send(newsReply);
  }

  const kbAnswer = findAnswerInKnowledgeBase(message);
  if (kbAnswer) {
    const reply = `${kbAnswer.answer} [Fonte: ${kbAnswer.source}]`;
    history.push({ role: 'assistant', content: reply, timestamp: Date.now() });
    await userRef.set({ messages: history });
    return res.send(reply);
  }

  const lang = detectLanguage(message);
  history.push({
    role: 'system',
    content: `Você é um assistente pró-Israel com valores judaico-cristãos. Responda com clareza e no idioma: ${lang}.`,
    timestamp: Date.now()
  });

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4-turbo',
        messages: history,
        max_tokens: 300
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const reply = response.data.choices[0].message.content.trim();
    history.push({ role: 'assistant', content: reply, timestamp: Date.now() });
    await userRef.set({ messages: history });
    return res.send(reply);

  } catch (error) {
    console.error('Erro com ChatGPT:', error.message);
    return res.send("Erro ao gerar resposta. Tente novamente.");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
