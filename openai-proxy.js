// netlify/functions/openai-proxy.js
// This file handles secure API calls to OpenAI.

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
  /do you remember/i,
  /tell me about/i,
  /what did we/i,
  /when did i/i,
  /have we discussed/i,
  /did we talk about/i
];

const MAIN_MODEL = process.env.OPENAI_MAIN_MODEL || 'gpt-4o';
const UTILITY_MODEL = process.env.OPENAI_UTILITY_MODEL || 'gpt-4o-mini';

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

async function searchMemory(query) {
  const vectorStoreId = process.env.MEMORY_VECTOR_STORE_ID;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!vectorStoreId || !apiKey) return '';

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
    return '';
  }

  const data = await response.json();
  return formatMemoryResults(data.data || []);
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
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { messages, model, task } = JSON.parse(event.body);
    let apiMessages = messages;

    if (Array.isArray(messages) && shouldSearchMemory(messages)) {
      const memoryContext = await searchMemory(getLastUserMessage(messages));
      apiMessages = withMemoryContext(messages, memoryContext);
    }

    // Call OpenAI API
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
      body: JSON.stringify(data)
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error', details: error.message })
    };
  }
};
