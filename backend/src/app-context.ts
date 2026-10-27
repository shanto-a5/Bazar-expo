/**
 * Service container (M7-F / M8).
 *
 * One object wires the repository bundle to every service. The HTTP app receives
 * it rather than constructing services itself, which is what lets the test suite
 * boot the real routes against the in-memory driver.
 *
 * M8: the mail transport is resolved here, once, from configuration — so
 * `AuthService` depends on the `MailTransport` interface and a test can inject a
 * recorder without a network or a log scrape.
 */
import { AuthService } from './services/auth.service';
import { CartService } from './services/cart.service';
import { CatalogService } from './services/catalog.service';
import { OrderService } from './services/order.service';
import { SellerService } from './services/seller.service';
import { createMailTransport, type MailTransport } from './mail/mail';
import type { RepositoryBundle } from './repositories/contracts';

export interface AppContext {
  repos: RepositoryBundle;
  auth: AuthService;
  catalog: CatalogService;
  cart: CartService;
  orders: OrderService;
  sellers: SellerService;
  driver: RepositoryBundle['driver'];
  mail: MailTransport;
}

export function createContext(repos: RepositoryBundle, mail: MailTransport = createMailTransport()): AppContext {
  const cart = new CartService(repos);
  return {
    repos,
    cart,
    mail,
    auth: new AuthService(repos, mail),
    catalog: new CatalogService(repos),
    orders: new OrderService(repos, cart),
    sellers: new SellerService(repos),
    driver: repos.driver,
  };
}
