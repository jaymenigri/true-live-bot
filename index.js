const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const dotenv = require('dotenv');

// Carregar variáveis de ambiente
dotenv.config();

// Inicializar o Firebase
const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rota para receber mensagens do Twilio
app.post('/webhook', async (req, res) => {
    const from = req.body.From; // Número do usuário
    const message = req.body.Body; // Mensagem enviada pelo usuário

    // Buscar histórico de conversa no Firebase
    const userRef = db.collection('conversations').doc(from);
    const userDoc = await userRef.get();
    let conversationHistory = userDoc.exists ? userDoc.data().messages : [];

    // Adicionar a mensagem do usuário ao histórico
    conversationHistory.push({ role: 'user', content: message });

    // Limitar o histórico a 30 dias (aproximadamente)
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

    // Chamar o ChatGPT para gerar uma resposta
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
