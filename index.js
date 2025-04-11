const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const dotenv = require('dotenv');
const knowledgeBase = require('./knowledge-base.json');
const trustedSources = require('./trusted-sources.json');

dotenv.config();

const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Carregar os domínios confiáveis do trusted-sources.json
const trustedNewsDomains = trustedSources.domains;

// Palavras-chave para identificar temas relacionados a Israel, antissemitismo, geopolítica, etc.
const israelKeywords = [
  'israel', 'israeli', 'palestine', 'palestinian', 'gaza', 'west bank', 'jerusalem',
  'anti-semitism', 'antisemitism', 'holocaust', 'shoah', 'jew', 'jewish', 'hebrew',
  'zionism', 'zionist', 'idf', 'netanyahu', 'likud', 'labor party', 'knesset',
  'middle east', 'lebanon', 'syria', 'iran', 'saudi arabia', 'egypt', 'jordan',
  'peace process', 'two-state solution', 'settlements', 'occupation', 'intifada',
  'hamas', 'hezbollah', 'plo', 'fatah', 'abbas', 'arafat', 'ben-gurion', 'begin',
  'sharon', 'olmert', 'peres', 'rabin', 'golda meir', 'david ben-gurion',
  'alan dershowitz', 'natan sharansky', 'daniel gordis', 'michael oren', 'efraim inbar',
  'yossi klein halevi', 'benny morris', 'ari shavit', 'yehuda avner', 'a.b. yehoshua',
  'jonathan sarna', 'shlomo ben-ami', 'gershom gorenberg', 'ehud barak', 'itamar rabinovich',
  'zeev jabotinsky', 'chaim weizmann', 'zvi elpeleg', 'shabtai teveth', 'mordechai kedar',
  'ehud yaari', 'amos oz', 'zeev schiff', 'arnon soffer', 'eitan haber', 'daniel pipes',
  'yossi melman', 'shlomo gazit', 'david horowitz', 'michael mandelbaum', 'benny begin',
  'haim gouri', 'amos elon', 'etgar keret', 'ron dermer', 'samuel feldberg', 'jayme nigri',
];

// Função para detectar o idioma da mensagem (heurística simples)
function detectLanguage(message) {
  const lowerMessage = message.toLowerCase();
  if (lowerMessage.includes('qual') || lowerMessage.includes('notícias') || lowerMessage.includes('israel')) {
    return 'pt'; // Português
  } else if (lowerMessage.includes('what') || lowerMessage.includes('news') || lowerMessage.includes('israel')) {
    return 'en'; // Inglês
  }
  return 'en'; // Padrão: inglês
}

// Função para verificar se a mensagem é uma solicitação de notícias
function isNewsRequest(message) {
  const lowerMessage = message.toLowerCase();
  return lowerMessage.includes('últimas notícias') || 
         lowerMessage.includes('notícias recentes') || 
         lowerMessage.includes('latest news') || 
         lowerMessage.includes('recent news') ||
         lowerMessage.includes('situação atual') || 
         lowerMessage.includes('current situation') ||
         lowerMessage.includes('hoje') || 
         lowerMessage.includes('today');
}

// Função para verificar se a mensagem é sobre Israel, antissemitismo, geopolítica, etc.
function isIsraelRelated(message) {
  const lowerMessage = message.toLowerCase();
  return israelKeywords.some(keyword => lowerMessage.includes(keyword));
}

// Função para verificar se a mensagem é sobre eventos recentes
function isAboutRecentEvents(message) {
  const lowerMessage = message.toLowerCase();
  const recentKeywords = ['current', 'now', 'today', 'this year', '2024', '2025', 'recently', 'latest', 'situação atual', 'hoje'];
  return recentKeywords.some(keyword => lowerMessage.includes(keyword));
}

// Função para buscar notícias recentes usando a NewsAPI
async function fetchLatestNews(query, language, useTrustedDomains = false) {
  try {
    const params = {
      q: query,
      apiKey: process.env.NEWSAPI_KEY,
      sortBy: 'publishedAt',
      pageSize: 1,
      from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // Últimos 7 dias
      language: language,
    };

    // Se for um tema relacionado a Israel, usar apenas domínios confiáveis
    if (useTrustedDomains) {
      params.domains = trustedNewsDomains.join(',');
    }

    const response = await axios.get('https://newsapi.org/v2/everything', { params });
    const article = response.data.articles[0];
    if (article) {
      return `Notícia recente: ${article.title}. Publicado em ${article.publishedAt}. [Fonte: ${article.source.name}] Link: ${article.url}`;
    }
    return useTrustedDomains
      ? "Não encontrei notícias recentes sobre esse tópico nas fontes confiáveis."
      : "Não encontrei notícias recentes sobre esse tópico.";
  } catch (error) {
    console.error('Erro ao buscar notícias:', error.message);
    return "Desculpe, não consegui buscar notícias recentes.";
  }
}

// Função para buscar artigos relevantes (usada para perguntas que não são explicitamente sobre notícias)
async function fetchRelevantArticle(query, language, useTrustedDomains = false) {
  try {
    const params = {
      q: query,
      apiKey: process.env.NEWSAPI_KEY,
      sortBy: 'relevancy',
      pageSize: 1,
      language: language,
    };

    if (useTrustedDomains) {
      params.domains = trustedNewsDomains.join(',');
    }

    const response = await axios.get('https://newsapi.org/v2/everything', { params });
    const article = response.data.articles[0];
    if (article) {
      return `Para mais informações sobre "${query}", veja este artigo: ${article.title} [Fonte: ${article.source.name}] Link: ${article.url}`;
    }
    return useTrustedDomains
      ? "Não encontrei informações relevantes sobre esse tópico nas fontes confiáveis."
      : "Não encontrei informações relevantes sobre esse tópico.";
  } catch (error) {
    console.error('Erro ao buscar artigo relevante:', error.message);
    return "Desculpe, não consegui encontrar informações relevantes.";
  }
}

// Função para buscar respostas na base de conhecimento
function findAnswerInKnowledgeBase(message) {
  const lowerMessage = message.toLowerCase().trim();
  const fact = knowledgeBase.facts.find(f => lowerMessage.includes(f.question.toLowerCase()));
  if (fact) {
    return {
      answer: fact.answer,
      source: fact.source,
    };
  }
  return null;
}

// Rota do webhook para o Twilio (WhatsApp)
app.post('/webhook', async (req, res) => {
  const from = req.body.From;
  const message = req.body.Body;

  // Acessar o histórico de conversa no Firebase
  const userRef = db.collection('conversations').doc(from);
  const userDoc = await userRef.get();
  let conversationHistory = userDoc.exists ? userDoc.data().messages : [];

  // Adicionar a mensagem do usuário ao histórico
  conversationHistory.push({ role: 'user', content: message, timestamp: Date.now() });

  // Limpar mensagens com mais de 30 dias
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  conversationHistory = conversationHistory.filter(msg => msg.timestamp > thirtyDaysAgo);

  // Mensagem inicial se for a primeira interação
  if (conversationHistory.length === 1) {
    const welcomeMessage = "Olá, eu sou o True Live! Como posso ajudar você hoje?";
    conversationHistory.push({ role: 'assistant', content: welcomeMessage, timestamp: Date.now() });
    await userRef.set({ messages: conversationHistory });
    res.set('Content-Type', 'text/plain');
    return res.send(welcomeMessage);
  }

  // Detectar idioma, se é sobre notícias, se é sobre Israel e se é sobre eventos recentes
  const language = detectLanguage(message);
  const isNews = isNewsRequest(message);
  const isIsrael = isIsraelRelated(message);
  const isRecent = isAboutRecentEvents(message);

  // Se for uma solicitação explícita de notícias
  if (isNews) {
    let query = isIsrael ? 'Israel' : message; // Padrão para Israel ou a mensagem completa
    const match = message.match(/(?:últimas notícias|notícias recentes|latest news|recent news|situação atual|current situation|hoje|today)\s+(?:sobre|about)?\s+(.+)/i);
    if (match && match[1]) {
      query = match[1].trim();
    }
    const newsReply = await fetchLatestNews(query, language, isIsrael);
    conversationHistory.push({ role: 'assistant', content: newsReply, timestamp: Date.now() });
    await userRef.set({ messages: conversationHistory });
    res.set('Content-Type', 'text/plain');
    return res.send(newsReply);
  }

  // Se for um tema relacionado a Israel
  if (isIsrael) {
    // Primeiro, verificar a base de conhecimento
    const knowledgeAnswer = findAnswerInKnowledgeBase(message);
    if (knowledgeAnswer) {
      const reply = `${knowledgeAnswer.answer} [Fonte: ${knowledgeAnswer.source}]`;
      conversationHistory.push({ role: 'assistant', content: reply, timestamp: Date.now() });
      await userRef.set({ messages: conversationHistory });
      res.set('Content-Type', 'text/plain');
      return res.send(reply);
    }

    // Se for uma pergunta sobre eventos recentes, buscar artigo relevante
    if (isRecent) {
      const articleReply = await fetchRelevantArticle(message, language, true);
      conversationHistory.push({ role: 'assistant', content: articleReply, timestamp: Date.now() });
      await userRef.set({ messages: conversationHistory });
      res.set('Content-Type', 'text/plain');
      return res.send(articleReply);
    }

    // Se não for recente, usar ChatGPT (apenas para perguntas históricas ou genéricas sobre Israel)
    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-3.5-turbo',
          messages: conversationHistory,
          max_tokens: 150,
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );
      const reply = response.data.choices[0].message.content.trim();
      conversationHistory.push({ role: 'assistant', content: reply, timestamp: Date.now() });
      await userRef.set({ messages: conversationHistory });
      res.set('Content-Type', 'text/plain');
      return res.send(reply);
    } catch (error) {
      console.error('Erro ao chamar o ChatGPT:', error.message);
      res.set('Content-Type', 'text/plain');
      return res.send("Desculpe, algo deu errado ao tentar responder usando IA.");
    }
  }

  // Se não for relacionado a Israel
  if (isRecent) {
    const articleReply = await fetchRelevantArticle(message, language, false);
    conversationHistory.push({ role: 'assistant', content: articleReply, timestamp: Date.now() });
    await userRef.set({ messages: conversationHistory });
    res.set('Content-Type', 'text/plain');
    return res.send(articleReply);
  }

  // Para perguntas gerais não relacionadas a Israel e não recentes, usar ChatGPT
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: conversationHistory,
        max_tokens: 150,
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );
    const reply = response.data.choices[0].message.content.trim();
    conversationHistory.push({ role: 'assistant', content: reply, timestamp: Date.now() });
    await userRef.set({ messages: conversationHistory });
    res.set('Content-Type', 'text/plain');
    return res.send(reply);
  } catch (error) {
    console.error('Erro ao chamar o ChatGPT:', error.message);
    res.set('Content-Type', 'text/plain');
    return res.send("Desculpe, algo deu errado ao tentar responder usando IA.");
  }
});

// Iniciar o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
