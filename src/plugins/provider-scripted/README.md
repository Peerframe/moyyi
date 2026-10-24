# provider-scripted

A model provider that replays scripted stream events. Used by tests, evals and fault injection;
never by real sessions.

- `scriptedProvider(responses)` returns the plugin and the client; each model request consumes
  the next response.
- Running out of responses throws: that is a bug in the test, not a model failure.
- Abort before an event yields one `error` event with kind `cancelled`, matching the
  ModelClient contract.
