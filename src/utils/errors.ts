export class AppError extends Error {
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(message: string, statusCode = 500, details?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(message, 401);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 409, details);
  }
}

export function toHttpResponse(error: unknown): Response {
  if (error instanceof AppError) {
    return Response.json(
      {
        error: {
          type: error.name,
          message: error.message,
          details: error.details,
        },
      },
      { status: error.statusCode },
    );
  }

  // eslint-disable-next-line no-console
  console.error("Unexpected error", error);
  return Response.json(
    {
      error: {
        type: "InternalServerError",
        message: "Internal server error",
      },
    },
    { status: 500 },
  );
}
