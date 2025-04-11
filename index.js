const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const dotenv = require('dotenv');
const detectLanguage = require('./utils/detectLanguage');
const knowledgeBase = require('./knowledge-base.json');
const francTest = require('franc-min');
console.log(">>> TESTE FRANC:", typeof francTest);

dotenv.config();

// Inicializar Firebase
const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Função para buscar respostas na base de conhecimento
function findAnswerInKnowledgeBase(message) {
  const lowerCaseMessage = message.toLowerCase().trim();
  const fact = knowledgeBase.facts.find(f => lowerCaseMessage.includes(f.question.toLowerCase()));
  if (fact) {
    return {
      answer: fact.answer,
      source: fact.source
    };
  }
  return null;
}

// Buscar notícias recentes via NewsAPI
async function fetchRecentNews(query) {
  try {
    const response = await axios.get('https://newsapi.org/v2/everything', {
      params: {
        q: query || 'Israel',
        apiKey: process.env.NEWSAPI_KEY,
        sortBy: 'publishedAt',
        pageSize: 1,
        from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      },
    });

    const articles = response.data.articles;
    if (articles.length > 0) {
      const article = articles[0];
      return `🗞️ Notícia recente: *${article.title}* (${article.source.name}, ${new Date(article.publishedAt).toLocaleDateString()})`;
    }

    return "Nenhuma notícia recente foi encontrada sobre esse tema.";
  } catch (error) {
    console.error('Erro ao buscar notícias:', error.message);
    return "Erro ao buscar notícias recentes.";
  }
}

// Webhook do Twilio (WhatsApp)
app.post('/webhook', async (req, res) => {
  const from = req.body.From;
  const message = req.body.Body;

  // Acessar histórico do usuário
  const userRef = db.collection('conversations').doc(from);
  const userDoc = await userRef.get();
  let conversationHistory = userDoc.exists ? userDoc.data().messages : [];

  // Adicionar mensagem do usuário
  conversationHistory.push({ role: 'user', content: message, timestamp: Date.now() });

  // Limpar mensagens com mais de 30 dias
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  conversationHistory = conversationHistory.filter(msg => msg.timestamp > thirtyDaysAgo);

  // Mensagem inicial
  if (conversationHistory.length === 1) {
    const welcomeMessage = "Olá! Eu sou o *True Live*, seu mentor digital pró-Israel. Como posso ajudar você hoje?";
    conversationHistory.push({ role: 'assistant', content: welcomeMessage, timestamp: Date.now() });
    await userRef.set({ messages: conversationHistory });
    res.set('Content-Type', 'text/plain');
    return res.send(welcomeMessage);
  }

  // Verificar pedido de notícias recentes
  const lower = message.toLowerCase().trim();
  if (lower.includes("últimas notícias") || lower.includes("notícias recentes")) {
    let newsQuery = "Israel";
    const match = lower.match(/(?:últimas notícias|notícias recentes)\s+(?:sobre\s+)?(.+)/i);
    if (match && match[1]) {
      newsQuery = match[1].trim();
    }

    const newsReply = await fetchRecentNews(newsQuery);
    conversationHistory.push({ role: 'assistant', content: newsReply, timestamp: Date.now() });
    await userRef.set({ messages: conversationHistory });
    res.set('Content-Type', 'text/plain');
    return res.send(newsReply);
  }

  // Verificar na base de conhecimento
  const knowledgeAnswer = findAnswerInKnowledgeBase(message);
  if (knowledgeAnswer) {
    const reply = `${knowledgeAnswer.answer} [Fonte: ${knowledgeAnswer.source}]`;
    conversationHistory.push({ role: 'assistant', content: reply, timestamp: Date.now() });
    await userRef.set({ messages: conversationHistory });
    res.set('Content-Type', 'text/plain');
    return res.send(reply);
  }

  // Detectar idioma
  const lang = detectLanguage(message);

  // Instrução ao ChatGPT
  conversationHistory.push({
    role: 'system',
    content: `Você é um assistente pró-Israel com valores judaico-cristãos. Responda com clareza, embasamento e no idioma: ${lang}.`,
    timestamp: Date.now()
  });

  // Chamar o ChatGPT
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4-turbo',
        messages: conversationHistory,
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
    conversationHistory.push({ role: 'assistant', content: reply, timestamp: Date.now() });
    await userRef.set({ messages: conversationHistory });
    res.set('Content-Type', 'text/plain');
    return res.send(reply);

  } catch (error) {
    console.error('Erro ao chamar ChatGPT:', error.message);
    const errorMessage = "Desculpe, algo deu errado. Tente novamente mais tarde.";
    res.set('Content-Type', 'text/plain');
    return res.send(errorMessage);
  }
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
