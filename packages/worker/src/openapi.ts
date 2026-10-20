// The models API (src/app.ts) as an OpenAPI 3 spec: served at /api/v1/openapi.json, and stored in the home model,
// whose API spec feature reads it like any other spec. Its server is a path, so its operations are paths on this site.

const model = {
  type: 'object',
  description: 'An application model: its features and their inputs',
  required: ['version', 'name', 'features'],
  properties: {
    version: { type: 'integer', enum: [2], description: 'Format version' },
    name: { type: 'string', description: 'Name' },
    features: { type: 'array', items: { type: 'object' }, description: 'Feature instances' },
  },
}

const error = { description: 'Refused', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
const id = { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Model id' }

export const MODELS_API_SPEC = {
  openapi: '3.0.3',
  info: { title: 'Feature Domain models API', version: '1.0.0' },
  servers: [{ url: '/api/v1' }],
  components: {
    schemas: {
      ModelSummary: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Id' },
          name: { type: 'string', description: 'Name' },
          updated_at: { type: 'string', format: 'date-time', description: 'Last changed' },
        },
      },
      NewModel: {
        type: 'object',
        description: 'A name alone starts a model with one empty page; a whole model is stored as it is',
        required: ['name'],
        properties: { name: { type: 'string', minLength: 1, description: 'Name' } },
      },
      Created: { type: 'object', properties: { id: { type: 'string', description: 'Id' } } },
      Model: model,
      Error: {
        type: 'object',
        properties: { error: { type: 'string', description: 'What went wrong' }, problems: { type: 'array', items: { type: 'string' } } },
      },
    },
  },
  paths: {
    '/models': {
      get: {
        summary: 'List the models',
        responses: {
          '200': {
            description: 'The models, in the order they were created',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/ModelSummary' } } } },
          },
        },
      },
      post: {
        summary: 'Create a model',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/NewModel' } } } },
        responses: {
          '201': { description: 'Created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Created' } } } },
          '400': error,
        },
      },
    },
    '/models/{id}': {
      get: {
        summary: 'Read a model',
        parameters: [id],
        responses: { '200': { description: 'The model', content: { 'application/json': { schema: { $ref: '#/components/schemas/Model' } } } }, '404': error },
      },
      put: {
        summary: 'Save a model',
        parameters: [id, { name: 'If-Match', in: 'header', schema: { type: 'string' }, description: 'The revision it was made from (its ETag)' }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Model' } } } },
        responses: { '204': { description: 'Saved' }, '404': error, '412': error },
      },
      delete: {
        summary: 'Delete a model',
        parameters: [id],
        responses: { '204': { description: 'Deleted' } },
      },
    },
  },
}
