export default class MockProvider {
  id() {
    return 'sciflow-mock-provider';
  }

  async callApi(prompt) {
    const response = await fetch('http://127.0.0.1:5099/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer sk-mock-local-placeholder',
      },
      body: JSON.stringify({
        model: 'mock-model',
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      throw new Error(`mock gateway returned HTTP ${response.status}`);
    }

    const body = await response.json();
    return { output: body.choices?.[0]?.message?.content ?? '' };
  }
}
