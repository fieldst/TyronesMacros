import { z } from 'zod';

export function validate<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new Response(JSON.stringify({ 
      success: false, 
      error: 'Invalid input', 
      details: parsed.error.flatten() 
    }), { 
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  return parsed.data;
}

export function wrap(handler: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    try {
      return await handler(req);
    } catch (e: any) {
      if (e instanceof Response) return e;
      
      console.error('[API ERROR]', req.url, e?.stack || e);
      
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Internal server error' 
      }), { 
        status: 500, 
        headers: { 'Content-Type': 'application/json' }
      });
    }
  };
}