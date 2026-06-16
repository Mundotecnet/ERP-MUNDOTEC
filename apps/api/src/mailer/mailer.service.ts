import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { SentMessageInfo, Transporter } from 'nodemailer';

export interface SendMailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Wrapper liviano sobre `nodemailer`. Sprint 2 acepta dos transportes:
 *
 * - `MAIL_TRANSPORT=json` (default): `jsonTransport`. No envía nada; serializa el
 *   email a JSON, lo loguea con Nest Logger y permite que los tests lo
 *   intercepten leyendo `lastMessage`.
 * - `MAIL_TRANSPORT=smtp`: SMTP real. Requiere `SMTP_HOST`, `SMTP_PORT`,
 *   `SMTP_USER`, `SMTP_PASS`.
 *
 * `MAIL_FROM` debe estar definido en ambos modos.
 */
@Injectable()
export class MailerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailerService.name);
  private transporter!: Transporter;
  private lastJsonMessage: SentMessageInfo | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const transport = this.config.get<string>('MAIL_TRANSPORT') ?? 'json';
    if (transport === 'smtp') {
      this.transporter = nodemailer.createTransport({
        host: this.required('SMTP_HOST'),
        port: Number(this.config.get<string>('SMTP_PORT') ?? 587),
        secure: (this.config.get<string>('SMTP_SECURE') ?? 'false') === 'true',
        auth: {
          user: this.required('SMTP_USER'),
          pass: this.required('SMTP_PASS'),
        },
      });
    } else {
      this.transporter = nodemailer.createTransport({ jsonTransport: true });
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.transporter?.close) {
      this.transporter.close();
    }
    return Promise.resolve();
  }

  async send(input: SendMailInput): Promise<void> {
    const from = this.required('MAIL_FROM');
    const info = await this.transporter.sendMail({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    const transport = this.config.get<string>('MAIL_TRANSPORT') ?? 'json';
    if (transport === 'json') {
      this.lastJsonMessage = info;
      this.logger.log(`mail-stub to=${input.to} subject="${input.subject}"`);
    }
  }

  /**
   * Sólo usado por tests cuando el transporte es `json`: devuelve el último
   * mensaje serializado por nodemailer. Devuelve `null` en producción.
   */
  getLastJsonMessage(): SentMessageInfo | null {
    return this.lastJsonMessage;
  }

  private required(key: string): string {
    const v = this.config.get<string>(key);
    if (!v) throw new Error(`Variable de entorno requerida: ${key}`);
    return v;
  }
}
