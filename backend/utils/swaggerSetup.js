// LOW PRIORITY FIX: Swagger/OpenAPI setup
// Interactive API documentation setup

import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

const swaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'AI LMS Platform API',
            version: '1.0.0',
            description: 'Comprehensive Learning Management System API Documentation',
            contact: {
                name: 'API Support',
                email: 'support@lms-platform.com'
            },
            license: {
                name: 'MIT',
                url: 'https://opensource.org/licenses/MIT'
            }
        },
        servers: [
            ...(process.env.API_URL ? [{
                url: process.env.API_URL,
                description: process.env.NODE_ENV === 'production' ? 'Production server' : 'Development server'
            }] : []),
            ...(process.env.NODE_ENV !== 'production' ? [{
                url: 'http://localhost:5000',
                description: 'Local development server'
            }] : [])
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT'
                }
            },
            schemas: {
                Error: {
                    type: 'object',
                    properties: {
                        success: {
                            type: 'boolean',
                            example: false
                        },
                        error: {
                            type: 'object',
                            properties: {
                                code: {
                                    type: 'string',
                                    example: 'AUTH_1001'
                                },
                                message: {
                                    type: 'string',
                                    example: 'Authentication required'
                                }
                            }
                        }
                    }
                },
                Success: {
                    type: 'object',
                    properties: {
                        success: {
                            type: 'boolean',
                            example: true
                        },
                        data: {
                            type: 'object'
                        },
                        message: {
                            type: 'string',
                            example: 'Operation successful'
                        }
                    }
                }
            }
        },
        tags: [
            {
                name: 'Authentication',
                description: 'User authentication and authorization'
            },
            {
                name: 'Assessments',
                description: 'Assessment management'
            },
            {
                name: 'Student Assessments',
                description: 'Student assessment taking'
            },
            {
                name: 'Analytics',
                description: 'Analytics and reporting'
            },
            {
                name: 'Users',
                description: 'User management'
            },
            {
                name: 'Enhanced Features',
                description: 'Enhanced LMS features'
            }
        ]
    },
    apis: [
        './routes/**/*.js',
        './controllers/**/*.js',
        './server.js'
    ]
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

/**
 * Swagger UI setup middleware
 */
export const swaggerSetup = (app) => {
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
        customCss: '.swagger-ui .topbar { display: none }',
        customSiteTitle: 'LMS Platform API Documentation'
    }));

    // JSON endpoint for Swagger spec
    app.get('/api-docs.json', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.send(swaggerSpec);
    });
};

export default swaggerSetup;

