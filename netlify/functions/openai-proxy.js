// netlify/functions/openai-proxy.js
// This file handles secure API calls to OpenAI.

const crypto = require('crypto');

const MEMORY_TRIGGERS = [
  /erinnerst du dich/i,
  /wei[sß]t du noch/i,
  /haben wir/i,
  /hatten wir/i,
  /wor[üu]ber haben wir/i,
  /wann habe ich/i,
  /wann hab ich/i,
  /was habe ich/i,
  /was hab ich/i,
  /was wei[sß]t du/i,
  /erz[äa]hl mir von/i,
  /(?:wer ist|kennst du|wei[sß]t du.*wer).*(?:sabine|sandra|markus|edith|mama|flo|motte|flori|freundin(?:nen)?)/i,
  /(?:sabine|sandra|freundin(?:nen)?).*(?:erinner|wei[sß]t|kennengelernt|wodurch|damals|fr[üu]her|intensive zeit|geschichte|freundschaft)/i,
  /(?:erinner|wei[sß]t|kennengelernt|wodurch|damals|fr[üu]her|intensive zeit|geschichte|freundschaft).*(?:sabine|sandra|freundin(?:nen)?)/i,
  /(?:whatsapp|chatverlauf|unterhaltung|nachricht).*(?:sabine|sandra|mama|edith|markus)/i,
  /(?:sabine|sandra|mama|edith|markus).*(?:whatsapp|chatverlauf|unterhaltung|nachricht)/i,
  /\[\d{2}\.\d{2}\.\d{2},\s*\d{1,2}:\d{2}:\d{2}\].*(?:sabine|sandra|mama|edith|markus)/i,
  /do you remember/i,
  /tell me about/i,
  /what did we/i,
  /when did i/i,
  /have we discussed/i,
  /did we talk about/i
];

const MAIN_MODEL = process.env.OPENAI_MAIN_MODEL || 'gpt-4o';
const UTILITY_MODEL = process.env.OPENAI_UTILITY_MODEL || 'gpt-4o-mini';

function getPortalPassword() {
  return (process.env.PORTAL_PASSWORD || '').trim();
}

function createPortalToken() {
  const password = getPortalPassword();
  if (!password) return '';
  const secret = process.env.OPENAI_API_KEY || 'tatjana-portal';
  return crypto.createHmac('sha256', secret).update(password).digest('hex');
}

function isAuthorized(event) {
  if (!getPortalPassword()) return true;
  const token = event.headers['x-portal-auth'] || event.headers['X-Portal-Auth'];
  return Boolean(token) && token === createPortalToken();
}

function selectModel(requestedModel, task) {
  if (task === 'utility') return UTILITY_MODEL;
  return requestedModel || MAIN_MODEL;
}

function shouldSearchMemory(messages) {
  const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user');
  if (!lastUserMessage?.content) return false;
  return MEMORY_TRIGGERS.some((pattern) => pattern.test(lastUserMessage.content));
}

function getLastUserMessage(messages) {
  return [...messages].reverse().find((message) => message.role === 'user')?.content || '';
}

function extractMemoryText(result) {
  if (typeof result.content === 'string') return result.content;
  if (Array.isArray(result.content)) {
    return result.content
      .map((part) => part.text || part.content || '')
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function formatMemoryResults(results) {
  return results
    .map((result, index) => {
      const attrs = result.attributes || {};
      const title = attrs.title || 'Unbenannter Chat';
      const date = attrs.date || 'unbekanntes Datum';
      const content = extractMemoryText(result).trim();
      if (!content) return '';
      return `Erinnerung ${index + 1} | ${date} | ${title}\n${content}`;
    })
    .filter(Boolean)
    .join('\n\n---\n\n');
}

function summarizeMemoryResults(results) {
  return results.map((result) => {
    const attrs = result.attributes || {};
    const content = extractMemoryText(result).trim();
    return {
      title: attrs.title || 'Unbenannter Chat',
      date: attrs.date || 'unbekanntes Datum',
      score: typeof result.score === 'number' ? result.score : null,
      preview: content.slice(0, 220)
    };
  });
}

async function searchMemory(query) {
  const vectorStoreId = process.env.MEMORY_VECTOR_STORE_ID;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!vectorStoreId || !apiKey) {
    return {
      context: '',
      log: {
        searched: false,
        query,
        resultCount: 0,
        results: [],
        error: 'Vector Store ID oder OpenAI API Key fehlt.'
      }
    };
  }

  const response = await fetch(`https://api.openai.com/v1/vector_stores/${vectorStoreId}/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'OpenAI-Beta': 'assistants=v2'
    },
    body: JSON.stringify({
      query,
      max_num_results: 5,
      ranking_options: {
        score_threshold: 0.25
      }
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error('Memory search failed:', response.status, detail);
    return {
      context: '',
      log: {
        searched: true,
        query,
        resultCount: 0,
        results: [],
        error: `Memory search failed: ${response.status}`
      }
    };
  }

  const data = await response.json();
  const results = data.data || [];
  return {
    context: formatMemoryResults(results),
    log: {
      searched: true,
      query,
      resultCount: results.length,
      results: summarizeMemoryResults(results),
      error: ''
    }
  };
}

function withMemoryContext(messages, memoryContext) {
  if (!memoryContext) return messages;
  const memoryInstructions = `\n\nWICHTIGER ERINNERUNGSHINWEIS:\nWenn abgerufene Erinnerungen vorhanden sind, nutze sie direkt. Erfinde keine Details, ergänze keine Lücken mit Spekulationen und sage offen, wenn die Erinnerung unvollständig ist.\n\nABGERUFENE ERINNERUNGEN:\n${memoryContext}`;

  return messages.map((message, index) => {
    if (index === 0 && message.role === 'system') {
      return {
        ...message,
        content: `${message.content}${memoryInstructions}`
      };
    }
    return message;
  });
}

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  if (!isAuthorized(event)) {
    return {
      statusCode: 401,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: 'Portal password required', type: 'portal_auth_required' })
    };
  }

  try {
    const { messages, model, task } = JSON.parse(event.body);
    let apiMessages = messages;
    let memoryLog = {
      searched: false,
      query: getLastUserMessage(Array.isArray(messages) ? messages : []),
      resultCount: 0,
      results: [],
      error: ''
    };

    if (Array.isArray(messages) && shouldSearchMemory(messages)) {
      const memorySearch = await searchMemory(getLastUserMessage(messages));
      memoryLog = memorySearch.log;
      apiMessages = withMemoryContext(messages, memorySearch.context);
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: selectModel(model, task),
        messages: apiMessages,
        temperature: 1.0,
        top_p: 0.95,
        max_tokens: 4000
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('OpenAI chat failed:', response.status, data);
      return {
        statusCode: response.status,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          error: data.error?.message || 'OpenAI request failed',
          type: data.error?.type || 'openai_error'
        })
      };
    }

    if (!data.choices?.[0]?.message?.content) {
      console.error('Unexpected OpenAI response:', data);
      return {
        statusCode: 502,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          error: 'OpenAI returned an unexpected response shape',
          type: 'unexpected_openai_response'
        })
      };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ...data, memoryLog })
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error', details: error.message })
    };
  }
};
