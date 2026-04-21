// Express framework import karte hain, jo server banane mein madad karta hai
const express = require('express');
const app = express();

// Middleware jo JSON requests ko handle karta hai
app.use(express.json());

// Server ka port define karte hain, Railway automatically isse detect kar lega
const PORT = process.env.PORT || 3000;

// Yeh hamara main proxy endpoint hai
// Jab bhi koi /v1/... wala request karega, ye function run hoga
app.all('/v1/*', async (req, res) => {
  try {
    // Original Gemini API ka URL
    const targetUrl = `https://generativelanguage.googleapis.com${req.path}`;

    // Request ke headers ko copy karte hain
    const headers = { ...req.headers };

    // Host header remove karna zaroori hai, warna error milega
    delete headers.host;

    // Request forward karte hain Gemini API ko
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: headers,
      body: JSON.stringify(req.body),
    });

    // Gemini se jo response aaya, uska data lete hain
    const data = await response.json();

    // Response ko wapas user ko send karte hain
    res.status(response.status).json(data);

  } catch (error) {
    // Agar koi error aaye toh user ko bhejte hain
    console.error('Proxy Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Root URL par ek simple message dete hain
app.get('/', (req, res) => {
  res.send('Gemini Proxy is running!');
});

// Server start karte hain
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});