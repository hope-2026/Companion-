exports.handler = async () => {
  const enabled = Boolean((process.env.PORTAL_PASSWORD || '').trim());

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ enabled })
  };
};
