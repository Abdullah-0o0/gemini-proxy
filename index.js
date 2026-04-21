const express = require('express');
const axios = require('axios'); // Fetch ki jagah axios
const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;

app.all('/v1/*', async (req, res) => {
  try {
    const targetUrl = `https://generativelanguage.googleapis.com${req.url}`;
    const headers = { ...req.headers };
    delete headers.host;

    const response = await axios({
      method: req.method,
      url: targetUrl,
      headers: headers,
      data: req.method !== 'GET' ? req.body : undefined,
    });

    res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Proxy Error:', error.response ? error.response.data : error.message);
    res.status(error.response ? error.response.status : 500).json(error.response ? error.response.data : { error: 'Internal Server Error' });
  }
});

app.get('/', (req, res) => {
  res.send('Gemini Proxy is running!');
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
