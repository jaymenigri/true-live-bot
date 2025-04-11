const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const dotenv = require('dotenv');
const knowledgeBase = require('./knowledge-base.json');

dotenv.config();

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

// Função para buscar notícias recentes usando a NewsAPI
async function fetchRecentNews(query) {
    try {
        console.log(`Buscando notícias para a query: ${query}`); // Log para depuração
        let response = await axios.get('https://newsapi.org/v2/everything', {
            params: {
                q: query, // Ex.: "Israel"
                apiKey: process.env.NEWSAPI_KEY,
                sortBy: 'publishedAt', // Ordenar por data de publicação
                pageSize: 1, // Pegar apenas a notícia mais recente
                from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // Últimos 7 dias
            },
        });

        let articles = response.data.articles;
        console.log(`Resultados encontrados para "${query}": ${articles.length}`); // Log para depuração

        // Se não houver resultados, tentar uma query alternativa
        if (!articles || articles.length === 0) {
            console.log('Nenhum resultado encontrado, tentando query alternativa: "Israeli conflict"');
            response = await axios.get('https://newsapi.org/v2/everything', {
                params: {
                    q: 'Israeli conflict', // Query alternativa
                    apiKey: process.env.NEWSAPI_KEY,
                    sortBy: 'publishedAt',
                    pageSize: 1,
                    from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
                },
            });
            articles = response.data.articles;
            console.log(`Resultados encontrados para "Israeli conflict": ${articles.length}`);
        }

        if (articles && articles.length > 0) {
            const article = articles[0];
            return `Notícia recente: ${article.title}. Publicado em ${article.publishedAt}. [Fonte: ${article.source.name}]`;
        }
        return "Não encontrei notícias recentes sobre esse tópico.";
    } catch (error) {
        console.error('Erro ao buscar notícias:', error.message);
        return "Desculpe, não consegui buscar notícias recentes.";
    }
}

// Rota para o webhook do Twilio (WhatsApp)
app.post('/webhook', async (req, res) => {
    const from = req.body.From; // Número do usuário
    const message = req.body.Body; // Mensagem enviada pelo usuário

    // Acessar o histórico de conversa no Firebase
    const userRef = db.collection('conversations').doc(from);
    const userDoc = await userRef.get();
    let conversationHistory = userDoc.exists ? userDoc.data().messages : [];

    // Adicionar a mensagem do usuário ao histórico
    conversationHistory.push({ role: 'user', content: message, timestamp: Date.now() });

    // Limpar mensagens com mais de 30 dias
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    conversationHistory = conversationHistory.filter(msg => {
        const msgTimestamp = msg.timestamp || Date.now();
        return msgTimestamp > thirtyDaysAgo;
    });

    // Mensagem inicial se for a primeira interação
    if (conversationHistory.length === 1) {
        const welcomeMessage = "Olá, eu sou o True Live! Como posso ajudar você hoje?";
        conversationHistory.push({ role: 'assistant', content: welcomeMessage, timestamp: Date.now() });

        // Salvar no Firebase
        await userRef.set({ messages: conversationHistory });

        // Responder ao Twilio
        res.set('Content-Type', 'text/plain');
        return res.send(welcomeMessage);
    }

// Verificar se a mensagem é sobre notícias recentes
const lowerCaseMessage = message.toLowerCase().trim();
if (lowerCaseMessage.includes("últimas notícias") || lowerCaseMessage.includes("notícias recentes")) {
    // Extrair o tópico da mensagem (ex.: "últimas notícias sobre tecnologia" -> "tecnologia")
    let newsQuery = "Israel"; // Padrão
    const match = lowerCaseMessage.match(/(?:últimas notícias|notícias recentes)\s+(?:sobre\s+)?(.+)/i);
    if (match && match[1]) {
        newsQuery = match[1].trim();
    }
    const newsReply = await fetchRecentNews(newsQuery);
    conversationHistory.push({ role: 'assistant', content: newsReply, timestamp: Date.now() });

    // Salvar o histórico atualizado no Firebase
    await userRef.set({ messages: conversationHistory });

    // Responder ao Twilio
    res.set('Content-Type', 'text/plain');
    return res.send(newsReply);
}

    // Verificar a base de conhecimento
    const knowledgeAnswer = findAnswerInKnowledgeBase(message);
    if (knowledgeAnswer) {
        const reply = `${knowledgeAnswer.answer} [Fonte: ${knowledgeAnswer.source}]`;
        conversationHistory.push({ role: 'assistant', content: reply, timestamp: Date.now() });

        // Salvar o histórico atualizado no Firebase
        await userRef.set({ messages: conversationHistory });

        // Responder ao Twilio
        res.set('Content-Type', 'text/plain');
        return res.send(reply);
    }

    // Se não encontrar na base de conhecimento, usar o ChatGPT
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

        // Salvar o histórico atualizado no Firebase
        await userRef.set({ messages: conversationHistory });

        // Responder ao Twilio
        res.set('Content-Type', 'text/plain');
        return res.send(reply);
    } catch (error) {
        console.error('Erro ao chamar o ChatGPT:', error.message);
        const errorMessage = "Desculpe, algo deu errado. Tente novamente!";
        res.set('Content-Type', 'text/plain');
        return res.send(errorMessage);
    }
});

// Iniciar o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
