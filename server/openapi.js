// server/openapi.js
// Hand-authored OpenAPI 3.0 specification for the ECM JIRA Clone API.
// No external dependencies (no swagger-jsdoc / swagger-ui-express) — this is a
// plain JS object that conforms to the OpenAPI 3.0.3 schema and can be imported
// directly into Swagger UI, Postman, Insomnia, Stoplight, or any OpenAPI tool.
//
// API versioning: the API is currently v1. All endpoints are served under the
// `/api` prefix on the running server. The `info.version` field below tracks the
// documented contract version and should be bumped on breaking changes.

const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'ECM JIRA Clone API',
    version: '1.0.0',
    description: [
      'REST API for the ECM JIRA Clone — an agile project management tool.',
      '',
      '## Versioning',
      'This document describes **API v1**. All routes are served under the `/api`',
      'base path (e.g. `/api/issues`). Breaking changes will increment the major',
      'version in `info.version`; additive, backward-compatible changes bump the',
      'minor/patch version. Clients should not depend on undocumented fields.',
      '',
      '## Authentication',
      'Most endpoints require a JWT Bearer token obtained from `/api/auth/login`',
      'or `/api/auth/signup`. Send it in the `Authorization: Bearer <token>` header.',
      'The `/api/auth/*` (except `/me`) and documentation endpoints are public.',
    ].join('\n'),
    contact: { name: 'ECM JIRA Clone' },
    license: { name: 'MIT' },
  },
  servers: [
    { url: '/api', description: 'Current server (relative), API v1' },
    { url: 'http://localhost:4000/api', description: 'Local development' },
  ],
  tags: [
    { name: 'Auth', description: 'Signup, login, password reset, current user' },
    { name: 'Issues', description: 'Issue CRUD, status transitions, and search' },
    { name: 'Sprints', description: 'Sprint management' },
    { name: 'Projects', description: 'Project management' },
    { name: 'Comments', description: 'Issue comments with @mention support' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT issued by /api/auth/login or /api/auth/signup.',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'Issue not found' },
        },
        required: ['error'],
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 1 },
          email: { type: 'string', format: 'email', example: 'jane@sedintechnologies.com' },
          createdAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      AuthResponse: {
        type: 'object',
        properties: {
          user: { $ref: '#/components/schemas/User' },
          token: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
        },
      },
      Credentials: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email', example: 'jane@sedintechnologies.com' },
          password: { type: 'string', format: 'password', minLength: 6, example: 'secret123' },
          remember: { type: 'boolean', example: false, description: 'Login only: 30-day token when true' },
        },
      },
      Issue: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 42 },
          key: { type: 'string', example: 'JL-42' },
          title: { type: 'string', example: 'Add dark mode toggle' },
          description: { type: 'string', example: 'Users should be able to switch themes.' },
          priority: { type: 'string', enum: ['Low', 'Medium', 'High'], example: 'High' },
          assignee: { type: 'string', example: 'jane@sedintechnologies.com' },
          status: {
            type: 'string',
            enum: ['Backlog', 'To Do', 'In Progress', 'Code Review', 'Done'],
            example: 'In Progress',
          },
          issueType: { type: 'string', enum: ['Story', 'Bug', 'Task', 'Sub-task'], example: 'Story' },
          sprintId: { type: 'integer', nullable: true, example: 3 },
          projectId: { type: 'integer', nullable: true, example: 1 },
          parentId: { type: 'integer', nullable: true, example: null },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      IssueInput: {
        type: 'object',
        required: ['title', 'description', 'assignee', 'priority'],
        properties: {
          title: { type: 'string', example: 'Add dark mode toggle' },
          description: { type: 'string', example: 'Users should be able to switch themes.' },
          priority: { type: 'string', enum: ['Low', 'Medium', 'High'], example: 'High' },
          assignee: { type: 'string', example: 'jane@sedintechnologies.com' },
          status: {
            type: 'string',
            enum: ['Backlog', 'To Do', 'In Progress', 'Code Review', 'Done'],
            example: 'To Do',
          },
          issueType: { type: 'string', enum: ['Story', 'Bug', 'Task', 'Sub-task'], example: 'Story' },
          sprintId: { type: 'integer', nullable: true, example: 3 },
          projectId: { type: 'integer', nullable: true, example: 1 },
        },
      },
      StatusUpdate: {
        type: 'object',
        required: ['status'],
        properties: {
          status: {
            type: 'string',
            enum: ['Backlog', 'To Do', 'In Progress', 'Code Review', 'Done'],
            example: 'Done',
          },
        },
      },
      Sprint: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 3 },
          name: { type: 'string', example: 'Sprint 12' },
          goal: { type: 'string', example: 'Ship the reporting module' },
          status: { type: 'string', enum: ['planned', 'active', 'completed'], example: 'active' },
          startDate: { type: 'string', format: 'date', nullable: true },
          endDate: { type: 'string', format: 'date', nullable: true },
        },
      },
      Project: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 1 },
          key: { type: 'string', example: 'JL' },
          name: { type: 'string', example: 'JIRA Lite' },
          description: { type: 'string', nullable: true },
        },
      },
      Comment: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 7 },
          issueId: { type: 'integer', example: 42 },
          author: { type: 'string', example: 'jane@sedintechnologies.com' },
          body: { type: 'string', example: 'Nice work @john@sedintechnologies.com!' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      CommentInput: {
        type: 'object',
        required: ['body'],
        properties: {
          body: { type: 'string', example: 'Looks good @john@sedintechnologies.com' },
        },
      },
    },
    responses: {
      Unauthorized: {
        description: 'Missing or invalid JWT',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      Forbidden: {
        description: 'Authenticated but insufficient role',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      NotFound: {
        description: 'Resource not found',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
    },
  },
  // Default security: bearer token. Individual public operations override with `security: []`.
  security: [{ bearerAuth: [] }],
  paths: {
    '/health': {
      get: {
        tags: ['Auth'],
        summary: 'Health check',
        description: 'Public liveness probe.',
        security: [],
        responses: {
          200: {
            description: 'Service is up',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { status: { type: 'string', example: 'ok' } } },
              },
            },
          },
        },
      },
    },
    '/auth/signup': {
      post: {
        tags: ['Auth'],
        summary: 'Register a new user',
        security: [],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Credentials' } } },
        },
        responses: {
          201: {
            description: 'User created; returns user and JWT',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } } },
          },
          400: { description: 'Invalid email or short password', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          409: { description: 'Email already registered', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Authenticate and receive a JWT',
        security: [],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Credentials' } } },
        },
        responses: {
          200: {
            description: 'Authenticated; returns user and JWT',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } } },
          },
          400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Get the current authenticated user with roles',
        responses: {
          200: {
            description: 'Current user profile, workspace role, and project roles',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'integer' },
                    email: { type: 'string' },
                    memberId: { type: 'integer', nullable: true },
                    workspaceRole: { type: 'string', example: 'Admin' },
                    isOwner: { type: 'boolean' },
                    projectRoles: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/issues': {
      get: {
        tags: ['Issues'],
        summary: 'List / search issues',
        description: 'Returns all issues, optionally filtered by status.',
        parameters: [
          {
            name: 'status',
            in: 'query',
            required: false,
            schema: {
              type: 'string',
              enum: ['Backlog', 'To Do', 'In Progress', 'Code Review', 'Done'],
            },
            description: 'Filter issues by status',
          },
        ],
        responses: {
          200: {
            description: 'Array of issues',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Issue' } },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
      post: {
        tags: ['Issues'],
        summary: 'Create an issue',
        description: 'Requires at least the Member workspace role.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/IssueInput' } } },
        },
        responses: {
          201: {
            description: 'Issue created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Issue' } } },
          },
          400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
        },
      },
    },
    '/issues/{id}': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'integer' }, description: 'Issue id' },
      ],
      get: {
        tags: ['Issues'],
        summary: 'Get an issue by id',
        responses: {
          200: {
            description: 'The issue',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Issue' } } },
          },
          400: { description: 'Invalid id', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
      put: {
        tags: ['Issues'],
        summary: 'Update an issue',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/IssueInput' } } },
        },
        responses: {
          200: {
            description: 'Updated issue',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Issue' } } },
          },
          400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
      delete: {
        tags: ['Issues'],
        summary: 'Delete an issue',
        description: 'Cascades to labels, links, worklogs, attachments, custom-field values, and sub-tasks.',
        responses: {
          200: { description: 'Deleted' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/issues/{id}/status': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'integer' }, description: 'Issue id' },
      ],
      patch: {
        tags: ['Issues'],
        summary: 'Change an issue status',
        description: 'Transitions the issue; may trigger approval gating and automation rules.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/StatusUpdate' } } },
        },
        responses: {
          200: {
            description: 'Updated issue',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Issue' } } },
          },
          400: { description: 'Invalid status', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
          409: { description: 'Transition blocked (e.g. open sub-tasks or pending approval)', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/sprints': {
      get: {
        tags: ['Sprints'],
        summary: 'List sprints',
        responses: {
          200: {
            description: 'Array of sprints',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Sprint' } },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
      post: {
        tags: ['Sprints'],
        summary: 'Create a sprint',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', example: 'Sprint 12' },
                  goal: { type: 'string', example: 'Ship reporting' },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Sprint created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Sprint' } } },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
        },
      },
    },
    '/projects': {
      get: {
        tags: ['Projects'],
        summary: 'List projects',
        responses: {
          200: {
            description: 'Array of projects',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Project' } },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
      post: {
        tags: ['Projects'],
        summary: 'Create a project',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['key', 'name'],
                properties: {
                  key: { type: 'string', example: 'JL' },
                  name: { type: 'string', example: 'JIRA Lite' },
                  description: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Project created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Project' } } },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
        },
      },
    },
    '/issues/{id}/comments': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'integer' }, description: 'Issue id' },
      ],
      get: {
        tags: ['Comments'],
        summary: 'List comments on an issue',
        responses: {
          200: {
            description: 'Array of comments',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Comment' } },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
      post: {
        tags: ['Comments'],
        summary: 'Add a comment',
        description: '`@email` mentions in the body create notifications for mentioned users.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CommentInput' } } },
        },
        responses: {
          201: {
            description: 'Comment created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Comment' } } },
          },
          400: { description: 'Empty body', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
  },
}

export default openapiSpec
