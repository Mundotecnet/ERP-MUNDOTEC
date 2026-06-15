import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  userId: bigint | null;
  companyId: bigint | null;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

@Injectable()
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<RequestContext>();

  /**
   * Setea el contexto en el async resource actual con `enterWith`. Persiste
   * durante el resto de la ejecución sincrónica + cualquier llamado async
   * posterior dentro del mismo async context (request HTTP, suite de test, etc).
   *
   * Se prefiere a `AsyncLocalStorage.run(store, callback)` porque Prisma 5
   * pierde el store cuando despacha la query al engine — el handler de la
   * extensión termina viendo `undefined` aunque la llamada haya ocurrido dentro
   * del callback de `run`. `enterWith` ata el store al async resource padre
   * (request middleware o test) y sobrevive a esa frontera.
   */
  set(context: RequestContext): void {
    this.storage.enterWith(context);
  }

  /**
   * Ejecuta `fn` dentro de un scope con `context` y restaura el contexto previo
   * al salir. Útil en tests para aislar bloques.
   *
   * Implementado sobre `enterWith` + restore en finally por la misma razón que
   * `set`: `AsyncLocalStorage.run` no propaga a las queries Prisma.
   *
   * El check de thenable (no solo `instanceof Promise`) es crítico porque las
   * llamadas a Prisma devuelven `PrismaPromise`, que NO extiende `Promise`. Si
   * tratáramos un PrismaPromise como sync, restauraríamos el contexto antes de
   * que la query se ejecute y el handler de las extensiones vería el contexto
   * anterior — exactamente el bug que originó esta nota.
   */
  run<T>(context: RequestContext, fn: () => T | PromiseLike<T>): T | PromiseLike<T> {
    const prev = this.storage.getStore();
    this.storage.enterWith(context);
    const restore = (): void => {
      if (prev !== undefined) this.storage.enterWith(prev);
      else this.storage.disable();
    };
    try {
      const result = fn();
      if (isThenable(result)) {
        return Promise.resolve(result).finally(restore) as PromiseLike<T>;
      }
      restore();
      return result;
    } catch (err) {
      restore();
      throw err;
    }
  }

  get(): RequestContext | undefined {
    return this.storage.getStore();
  }

  getUserId(): bigint | null {
    return this.storage.getStore()?.userId ?? null;
  }

  getCompanyId(): bigint | null {
    return this.storage.getStore()?.companyId ?? null;
  }
}
