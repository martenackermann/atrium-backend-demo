import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { PUBLIC_OPENAPI_EXTENSION } from '@/common/auth/public.decorator';
import { PROBLEM_DETAILS_OPENAPI_SCHEMA } from '@/common/http/api-problem-response.decorator';

export const DOCS_PATH = 'docs';
export const OPENAPI_JSON_PATH = 'docs/openapi.json';

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

/** Builds the OpenAPI 3 document from controllers + nestjs-zod DTOs. */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Atrium API')
    .setDescription(
      'Employee self-service portal (portfolio demo by Acme IT Services). ' +
        'Errors use RFC 9457 `application/problem+json`; lists use `?page=&perPage=&sort=`.',
    )
    .setVersion('1.0.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
    .addSecurityRequirements('bearer')
    .build();

  const document = cleanupOpenApiDoc(
    SwaggerModule.createDocument(app, config, {
      operationIdFactory: (controllerKey, methodKey) => `${controllerKey.replace(/Controller$/, '')}_${methodKey}`,
    }),
  );

  document.components ??= {};
  document.components.schemas = {
    ...document.components.schemas,
    ProblemDetails: PROBLEM_DETAILS_OPENAPI_SCHEMA as never,
  };

  // `@Public()` routes: no bearer token required.
  for (const pathItem of Object.values(document.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method] as (Record<string, unknown> & { security?: unknown }) | undefined;
      if (operation?.[PUBLIC_OPENAPI_EXTENSION]) {
        delete operation[PUBLIC_OPENAPI_EXTENSION];
        operation.security = [];
      }
    }
  }
  return document;
}

export function setupSwagger(app: INestApplication): OpenAPIObject {
  const document = buildOpenApiDocument(app);
  SwaggerModule.setup(DOCS_PATH, app, document, {
    jsonDocumentUrl: OPENAPI_JSON_PATH,
    customSiteTitle: 'Atrium API',
    swaggerOptions: { persistAuthorization: true },
  });
  return document;
}
