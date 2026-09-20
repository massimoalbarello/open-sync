import { z } from 'zod';

const maxEndpointLength = 2048;
const maxKeyLength = 16384;
const endpointSchema = z
  .url()
  .max(maxEndpointLength)
  .regex(/^https:\/\/[^\s/#?@]+(?:[/?][^\s#]*)?$/)
  .refine((value) => {
    const url = new URL(value);
    return !url.username && !url.password && !url.hash;
  }, 'Enter an HTTPS endpoint without credentials or a fragment.');

export const setupSchema = z.strictObject({
  endpoint: endpointSchema.meta({
    title: 'Endpoint URL',
    examples: ['https://api.example.com/records'],
  }),
  apiKey: z
    .string()
    .min(1)
    .max(maxKeyLength)
    .regex(/^[^\r\n]*\S[^\r\n]*$/)
    .meta({
      title: 'API key',
      writeOnly: true,
      description: 'Stored encrypted. Used to authenticate deliveries to your endpoint.',
    }),
});
export const configSchema = z.strictObject({
  endpoint: endpointSchema,
  credential: z.string().min(1),
});
