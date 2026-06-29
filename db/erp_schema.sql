-- ============================================================================
-- ERP RETAIL - ESQUEMA DE BASE DE DATOS
-- Motor: PostgreSQL 15+
-- Módulos: Núcleo/Seguridad · Inventario y Compras · Ventas y CRM · Contabilidad
-- Convenciones:
--   * snake_case, claves primarias BIGINT IDENTITY
--   * Soft-delete vía columna deleted_at (NULL = activo)
--   * Auditoría: created_at, updated_at, created_by, updated_by
--   * Importes en NUMERIC(18,4); cantidades en NUMERIC(18,4)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. NÚCLEO Y SEGURIDAD
-- ============================================================================

CREATE TABLE company (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    legal_name      VARCHAR(200) NOT NULL,
    trade_name      VARCHAR(200),
    tax_id          VARCHAR(50)  NOT NULL UNIQUE,          -- RFC / NIT / RUC
    currency_code   CHAR(3)      NOT NULL DEFAULT 'USD',
    address         VARCHAR(300),
    phone           VARCHAR(50),
    email           VARCHAR(150),
    logo_url        VARCHAR(300),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE branch (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    code            VARCHAR(20)  NOT NULL,
    name            VARCHAR(150) NOT NULL,
    address         VARCHAR(300),
    phone           VARCHAR(50),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, code)
);

CREATE TABLE app_user (
    id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id             BIGINT NOT NULL REFERENCES company(id),
    username               VARCHAR(80)  NOT NULL,
    email                  VARCHAR(150) NOT NULL,
    password_hash          VARCHAR(255) NOT NULL,
    full_name              VARCHAR(150) NOT NULL,
    is_active              BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at          TIMESTAMPTZ,
    failed_login_attempts  INTEGER NOT NULL DEFAULT 0,         -- HU-2.1: contador para bloqueo
    locked_until           TIMESTAMPTZ,                        -- HU-2.1: si > now(), login bloqueado
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at             TIMESTAMPTZ,
    UNIQUE (company_id, username),
    UNIQUE (company_id, email)
);

CREATE TABLE role (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    name            VARCHAR(80) NOT NULL,
    description     VARCHAR(250),
    UNIQUE (company_id, name)
);

CREATE TABLE permission (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code            VARCHAR(100) NOT NULL UNIQUE,           -- ej: sales.invoice.create
    module          VARCHAR(50)  NOT NULL,
    description     VARCHAR(250)
);

CREATE TABLE role_permission (
    role_id         BIGINT NOT NULL REFERENCES role(id) ON DELETE CASCADE,
    permission_id   BIGINT NOT NULL REFERENCES permission(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_role (
    user_id         BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    role_id         BIGINT NOT NULL REFERENCES role(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);

CREATE TABLE audit_log (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         BIGINT REFERENCES app_user(id),
    entity          VARCHAR(80)  NOT NULL,
    entity_id       BIGINT,
    action          VARCHAR(20)  NOT NULL,                  -- INSERT/UPDATE/DELETE
    old_values      JSONB,
    new_values      JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);

-- HU-2.1 / HU-2.2 — refresh tokens stateful (revocables al hacer logout).
CREATE TABLE refresh_token (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    jti             VARCHAR(64) NOT NULL UNIQUE,            -- id único del JWT refresh
    token_hash      VARCHAR(255) NOT NULL,                  -- bcrypt del refresh emitido
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_user ON refresh_token(user_id);

-- HU-2.4 — políticas de contraseña configurables por empresa. Una fila por
-- company; si no existe, se aplican defaults en código (PasswordPolicyService).
CREATE TABLE password_policy (
    company_id        BIGINT  PRIMARY KEY REFERENCES company(id) ON DELETE CASCADE,
    min_length        INTEGER NOT NULL DEFAULT 10,
    require_upper     BOOLEAN NOT NULL DEFAULT TRUE,
    require_lower     BOOLEAN NOT NULL DEFAULT TRUE,
    require_digit     BOOLEAN NOT NULL DEFAULT TRUE,
    require_special   BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- HU-6.3 — parámetros generales por empresa (key/value JSONB). Soporta cosas
-- como prefijos de documentos, formatos, flags de features, etc. PK compuesta
-- (company_id, key) para unicidad por empresa.
CREATE TABLE company_param (
    company_id  BIGINT NOT NULL REFERENCES company(id) ON DELETE CASCADE,
    key         VARCHAR(80) NOT NULL,
    value       JSONB,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (company_id, key)
);

-- HU-2.3 — token de recuperación de contraseña. El email envía
-- `<jti>.<secret>`; la DB guarda jti en claro (lookup) y bcrypt(secret).
CREATE TABLE password_reset_token (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    jti             VARCHAR(64) NOT NULL UNIQUE,
    token_hash      VARCHAR(255) NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    used_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_reset_user ON password_reset_token(user_id);

-- ============================================================================
-- 2. CATÁLOGOS COMPARTIDOS
-- ============================================================================

CREATE TABLE currency (
    code            CHAR(3) PRIMARY KEY,
    name            VARCHAR(60) NOT NULL,
    symbol          VARCHAR(6),
    decimals        INT     NOT NULL DEFAULT 2 CHECK (decimals BETWEEN 0 AND 6),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE exchange_rate (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    currency_code   CHAR(3) NOT NULL REFERENCES currency(code),
    rate_date       DATE    NOT NULL,
    rate            NUMERIC(18,6) NOT NULL,
    UNIQUE (currency_code, rate_date)
);

CREATE TABLE tax (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    name            VARCHAR(60) NOT NULL,                   -- IVA 16%, Exento...
    rate            NUMERIC(7,4) NOT NULL,                  -- 0.1600
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE unit_of_measure (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code            VARCHAR(10) NOT NULL UNIQUE,            -- PZA, KG, LT, CAJA
    name            VARCHAR(60) NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

-- ============================================================================
-- 3. INVENTARIO Y PRODUCTOS
-- ============================================================================

CREATE TABLE product_category (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    parent_id       BIGINT REFERENCES product_category(id),
    name            VARCHAR(120) NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE product (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    sku             VARCHAR(60)  NOT NULL,
    barcode         VARCHAR(60),
    name            VARCHAR(200) NOT NULL,
    description     TEXT,
    category_id     BIGINT REFERENCES product_category(id),
    uom_id          BIGINT NOT NULL REFERENCES unit_of_measure(id),
    tax_id          BIGINT REFERENCES tax(id),
    cost_price      NUMERIC(18,4) NOT NULL DEFAULT 0,       -- costo de referencia (moneda base)
    sale_price      NUMERIC(18,4) NOT NULL DEFAULT 0,       -- precio base (moneda base)
    price_currency  CHAR(3) NOT NULL DEFAULT 'USD',         -- moneda del precio de referencia
    is_inventoried  BOOLEAN NOT NULL DEFAULT TRUE,          -- FALSE = servicio
    tracking_type   VARCHAR(10) NOT NULL DEFAULT 'NONE',    -- NONE, SERIAL, LOT
    warranty_months INT NOT NULL DEFAULT 0,                 -- garantía estándar del producto
    min_stock       NUMERIC(18,4) NOT NULL DEFAULT 0,
    max_stock       NUMERIC(18,4) NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    UNIQUE (company_id, sku)
);
CREATE INDEX idx_product_barcode ON product(barcode);
CREATE INDEX idx_product_name ON product(name);

CREATE TABLE warehouse (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    branch_id       BIGINT REFERENCES branch(id),
    code            VARCHAR(20) NOT NULL,
    name            VARCHAR(120) NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (company_id, code)
);

-- Existencias por producto y almacén (snapshot rápido)
CREATE TABLE stock (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id      BIGINT NOT NULL REFERENCES product(id),
    warehouse_id    BIGINT NOT NULL REFERENCES warehouse(id),
    quantity        NUMERIC(18,4) NOT NULL DEFAULT 0,
    avg_cost        NUMERIC(18,4) NOT NULL DEFAULT 0,       -- costo promedio
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (product_id, warehouse_id)
);

-- Kardex / movimientos de inventario (fuente de verdad)
CREATE TABLE stock_movement (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    product_id      BIGINT NOT NULL REFERENCES product(id),
    warehouse_id    BIGINT NOT NULL REFERENCES warehouse(id),
    movement_type   VARCHAR(20) NOT NULL,                   -- IN, OUT, ADJUST, TRANSFER
    source_doc      VARCHAR(30),                            -- PURCHASE, SALE, ADJUST...
    source_id       BIGINT,                                 -- id del documento origen
    quantity        NUMERIC(18,4) NOT NULL,                 -- + entrada / - salida
    unit_cost       NUMERIC(18,4) NOT NULL DEFAULT 0,
    balance_qty     NUMERIC(18,4) NOT NULL DEFAULT 0,       -- saldo tras el movimiento
    movement_date   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by      BIGINT REFERENCES app_user(id),
    notes           VARCHAR(250)
);
CREATE INDEX idx_movement_product ON stock_movement(product_id, warehouse_id, movement_date);

-- ============================================================================
-- 4. TERCEROS (CLIENTES Y PROVEEDORES)
-- ============================================================================

CREATE TABLE partner (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    partner_type    VARCHAR(10) NOT NULL,                   -- CUSTOMER, SUPPLIER, BOTH
    code            VARCHAR(30),
    legal_name      VARCHAR(200) NOT NULL,
    trade_name      VARCHAR(200),
    tax_id          VARCHAR(50),
    email           VARCHAR(150),
    phone           VARCHAR(50),
    address         VARCHAR(300),
    currency_code   CHAR(3) NOT NULL DEFAULT 'USD',         -- moneda preferida de operación
    credit_limit    NUMERIC(18,4) NOT NULL DEFAULT 0,
    credit_days     INT NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    UNIQUE (company_id, code)
);
CREATE INDEX idx_partner_name ON partner(legal_name);

CREATE TABLE partner_contact (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    partner_id      BIGINT NOT NULL REFERENCES partner(id) ON DELETE CASCADE,
    name            VARCHAR(150) NOT NULL,
    position        VARCHAR(100),
    email           VARCHAR(150),
    phone           VARCHAR(50)
);

-- ============================================================================
-- 5. COMPRAS
-- ============================================================================

CREATE TABLE purchase_order (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    branch_id       BIGINT REFERENCES branch(id),
    supplier_id     BIGINT NOT NULL REFERENCES partner(id),
    order_number    VARCHAR(30) NOT NULL,
    order_date      DATE NOT NULL DEFAULT CURRENT_DATE,
    expected_date   DATE,
    status          VARCHAR(20) NOT NULL DEFAULT 'DRAFT',   -- DRAFT, APPROVED, RECEIVED, CANCELLED
    currency_code   CHAR(3) NOT NULL DEFAULT 'USD',         -- moneda del documento
    exchange_rate   NUMERIC(18,6) NOT NULL DEFAULT 1,       -- tasa a moneda base en la fecha
    subtotal        NUMERIC(18,4) NOT NULL DEFAULT 0,
    tax_amount      NUMERIC(18,4) NOT NULL DEFAULT 0,
    total           NUMERIC(18,4) NOT NULL DEFAULT 0,       -- total en moneda del documento
    base_total      NUMERIC(18,4) NOT NULL DEFAULT 0,       -- total convertido a moneda base
    notes           VARCHAR(300),
    created_by      BIGINT REFERENCES app_user(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, order_number)
);

CREATE TABLE purchase_order_line (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    purchase_order_id BIGINT NOT NULL REFERENCES purchase_order(id) ON DELETE CASCADE,
    product_id      BIGINT NOT NULL REFERENCES product(id),
    quantity        NUMERIC(18,4) NOT NULL,
    received_qty    NUMERIC(18,4) NOT NULL DEFAULT 0,
    unit_cost       NUMERIC(18,4) NOT NULL,
    tax_rate        NUMERIC(7,4) NOT NULL DEFAULT 0,
    line_total      NUMERIC(18,4) NOT NULL
);

CREATE TABLE goods_receipt (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    purchase_order_id BIGINT REFERENCES purchase_order(id),
    warehouse_id    BIGINT NOT NULL REFERENCES warehouse(id),
    receipt_number  VARCHAR(30) NOT NULL,
    receipt_date    DATE NOT NULL DEFAULT CURRENT_DATE,
    created_by      BIGINT REFERENCES app_user(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, receipt_number)
);

CREATE TABLE goods_receipt_line (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    goods_receipt_id BIGINT NOT NULL REFERENCES goods_receipt(id) ON DELETE CASCADE,
    product_id      BIGINT NOT NULL REFERENCES product(id),
    quantity        NUMERIC(18,4) NOT NULL,
    unit_cost       NUMERIC(18,4) NOT NULL
);

-- ============================================================================
-- 6. VENTAS Y CRM
-- ============================================================================

-- CRM: pipeline de oportunidades
CREATE TABLE crm_stage (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    name            VARCHAR(60) NOT NULL,
    sort_order      INT NOT NULL DEFAULT 0,
    is_won          BOOLEAN NOT NULL DEFAULT FALSE,
    is_lost         BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE crm_opportunity (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    partner_id      BIGINT REFERENCES partner(id),
    stage_id        BIGINT NOT NULL REFERENCES crm_stage(id),
    owner_user_id   BIGINT REFERENCES app_user(id),
    title           VARCHAR(200) NOT NULL,
    expected_amount NUMERIC(18,4) NOT NULL DEFAULT 0,
    probability     NUMERIC(5,2) NOT NULL DEFAULT 0,
    expected_close  DATE,
    status          VARCHAR(20) NOT NULL DEFAULT 'OPEN',     -- OPEN, WON, LOST
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE crm_activity (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    opportunity_id  BIGINT REFERENCES crm_opportunity(id) ON DELETE CASCADE,
    partner_id      BIGINT REFERENCES partner(id),
    user_id         BIGINT REFERENCES app_user(id),
    activity_type   VARCHAR(20) NOT NULL,                    -- CALL, EMAIL, MEETING, TASK
    subject         VARCHAR(200) NOT NULL,
    notes           TEXT,
    due_date        TIMESTAMPTZ,
    completed       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ventas
CREATE TABLE sales_order (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    branch_id       BIGINT REFERENCES branch(id),
    customer_id     BIGINT NOT NULL REFERENCES partner(id),
    opportunity_id  BIGINT REFERENCES crm_opportunity(id),
    order_number    VARCHAR(30) NOT NULL,
    order_date      DATE NOT NULL DEFAULT CURRENT_DATE,
    status          VARCHAR(20) NOT NULL DEFAULT 'DRAFT',    -- DRAFT, CONFIRMED, INVOICED, CANCELLED
    currency_code   CHAR(3) NOT NULL DEFAULT 'USD',          -- moneda del documento
    exchange_rate   NUMERIC(18,6) NOT NULL DEFAULT 1,        -- tasa a moneda base en la fecha
    subtotal        NUMERIC(18,4) NOT NULL DEFAULT 0,
    tax_amount      NUMERIC(18,4) NOT NULL DEFAULT 0,
    discount_amount NUMERIC(18,4) NOT NULL DEFAULT 0,
    total           NUMERIC(18,4) NOT NULL DEFAULT 0,        -- total en moneda del documento
    base_total      NUMERIC(18,4) NOT NULL DEFAULT 0,        -- total convertido a moneda base
    notes           VARCHAR(300),
    created_by      BIGINT REFERENCES app_user(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, order_number)
);

CREATE TABLE sales_order_line (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sales_order_id  BIGINT NOT NULL REFERENCES sales_order(id) ON DELETE CASCADE,
    product_id      BIGINT NOT NULL REFERENCES product(id),
    quantity        NUMERIC(18,4) NOT NULL,
    unit_price      NUMERIC(18,4) NOT NULL,
    discount_rate   NUMERIC(7,4) NOT NULL DEFAULT 0,
    tax_rate        NUMERIC(7,4) NOT NULL DEFAULT 0,
    line_total      NUMERIC(18,4) NOT NULL
);

CREATE TABLE invoice (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    branch_id       BIGINT REFERENCES branch(id),
    customer_id     BIGINT NOT NULL REFERENCES partner(id),
    sales_order_id  BIGINT REFERENCES sales_order(id),
    service_order_id BIGINT,                                  -- FK a service_order (módulo de taller)
    invoice_number  VARCHAR(40) NOT NULL,
    invoice_date    DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date        DATE,
    status          VARCHAR(20) NOT NULL DEFAULT 'ISSUED',   -- ISSUED, PARTIAL, PAID, CANCELLED
    currency_code   CHAR(3) NOT NULL DEFAULT 'USD',          -- moneda del documento
    exchange_rate   NUMERIC(18,6) NOT NULL DEFAULT 1,        -- tasa a moneda base en la fecha
    subtotal        NUMERIC(18,4) NOT NULL DEFAULT 0,
    tax_amount      NUMERIC(18,4) NOT NULL DEFAULT 0,
    total           NUMERIC(18,4) NOT NULL DEFAULT 0,        -- total en moneda del documento
    base_total      NUMERIC(18,4) NOT NULL DEFAULT 0,        -- total convertido a moneda base
    paid_amount     NUMERIC(18,4) NOT NULL DEFAULT 0,
    balance         NUMERIC(18,4) NOT NULL DEFAULT 0,
    created_by      BIGINT REFERENCES app_user(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, invoice_number)
);

CREATE TABLE invoice_line (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    invoice_id      BIGINT NOT NULL REFERENCES invoice(id) ON DELETE CASCADE,
    product_id      BIGINT REFERENCES product(id),
    description     VARCHAR(250),
    quantity        NUMERIC(18,4) NOT NULL,
    unit_price      NUMERIC(18,4) NOT NULL,
    tax_rate        NUMERIC(7,4) NOT NULL DEFAULT 0,
    line_total      NUMERIC(18,4) NOT NULL
);

CREATE TABLE payment (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    partner_id      BIGINT NOT NULL REFERENCES partner(id),
    payment_type    VARCHAR(10) NOT NULL,                    -- IN (cobro), OUT (pago)
    payment_date    DATE NOT NULL DEFAULT CURRENT_DATE,
    method          VARCHAR(20) NOT NULL,                    -- CASH, CARD, TRANSFER, CHECK
    amount          NUMERIC(18,4) NOT NULL,                  -- monto en moneda del pago
    currency_code   CHAR(3) NOT NULL DEFAULT 'USD',
    exchange_rate   NUMERIC(18,6) NOT NULL DEFAULT 1,        -- tasa a moneda base en la fecha
    base_amount     NUMERIC(18,4) NOT NULL DEFAULT 0,        -- monto convertido a moneda base
    reference       VARCHAR(100),
    created_by      BIGINT REFERENCES app_user(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Aplicación de pagos a facturas (un pago puede cubrir varias facturas)
CREATE TABLE payment_allocation (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    payment_id      BIGINT NOT NULL REFERENCES payment(id) ON DELETE CASCADE,
    invoice_id      BIGINT NOT NULL REFERENCES invoice(id),
    amount          NUMERIC(18,4) NOT NULL
);

-- ============================================================================
-- 7. CONTABILIDAD Y FINANZAS
-- ============================================================================

CREATE TABLE account (                                       -- plan de cuentas
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    code            VARCHAR(20) NOT NULL,
    name            VARCHAR(150) NOT NULL,
    account_type    VARCHAR(20) NOT NULL,                    -- ASSET, LIABILITY, EQUITY, INCOME, EXPENSE
    parent_id       BIGINT REFERENCES account(id),
    is_postable     BOOLEAN NOT NULL DEFAULT TRUE,           -- FALSE = cuenta agrupadora
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (company_id, code)
);

CREATE TABLE fiscal_period (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    name            VARCHAR(40) NOT NULL,                    -- 2026-06
    start_date      DATE NOT NULL,
    end_date        DATE NOT NULL,
    is_closed       BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (company_id, name)
);

CREATE TABLE journal_entry (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    period_id       BIGINT NOT NULL REFERENCES fiscal_period(id),
    entry_number    VARCHAR(30) NOT NULL,
    entry_date      DATE NOT NULL DEFAULT CURRENT_DATE,
    description     VARCHAR(300),
    source_doc      VARCHAR(30),                             -- INVOICE, PAYMENT, MANUAL...
    source_id       BIGINT,
    is_posted       BOOLEAN NOT NULL DEFAULT FALSE,
    created_by      BIGINT REFERENCES app_user(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, entry_number)
);

CREATE TABLE journal_line (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    journal_entry_id BIGINT NOT NULL REFERENCES journal_entry(id) ON DELETE CASCADE,
    account_id      BIGINT NOT NULL REFERENCES account(id),
    partner_id      BIGINT REFERENCES partner(id),
    debit           NUMERIC(18,4) NOT NULL DEFAULT 0,        -- débito en moneda base
    credit          NUMERIC(18,4) NOT NULL DEFAULT 0,        -- crédito en moneda base
    currency_code   CHAR(3) NOT NULL DEFAULT 'USD',          -- moneda de origen de la línea
    exchange_rate   NUMERIC(18,6) NOT NULL DEFAULT 1,        -- tasa aplicada
    currency_debit  NUMERIC(18,4) NOT NULL DEFAULT 0,        -- débito en moneda de origen
    currency_credit NUMERIC(18,4) NOT NULL DEFAULT 0,        -- crédito en moneda de origen
    description     VARCHAR(250),
    CONSTRAINT chk_debit_credit CHECK (debit >= 0 AND credit >= 0)
);
CREATE INDEX idx_journal_line_account ON journal_line(account_id);

-- ============================================================================
-- 8. LISTAS DE PRECIOS MULTIMONEDA
-- ============================================================================
-- Permite vender/comprar productos con precios definidos por moneda, sin
-- depender únicamente de la conversión por tipo de cambio.

CREATE TABLE price_list (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    name            VARCHAR(100) NOT NULL,                   -- "Lista USD", "Mayoreo MXN"
    currency_code   CHAR(3) NOT NULL REFERENCES currency(code),
    list_type       VARCHAR(10) NOT NULL DEFAULT 'SALE',     -- SALE, PURCHASE
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (company_id, name)
);

CREATE TABLE price_list_item (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    price_list_id   BIGINT NOT NULL REFERENCES price_list(id) ON DELETE CASCADE,
    product_id      BIGINT NOT NULL REFERENCES product(id),
    price           NUMERIC(18,4) NOT NULL,                  -- precio en la moneda de la lista
    min_quantity    NUMERIC(18,4) NOT NULL DEFAULT 1,        -- para precios por volumen
    valid_from      DATE,
    valid_to        DATE,
    UNIQUE (price_list_id, product_id, min_quantity)
);

-- ============================================================================
-- 9. SERIALES Y GARANTÍAS
-- ============================================================================
-- Aplica a productos con tracking_type = 'SERIAL'. Cada unidad física se
-- identifica individualmente y se rastrea desde su entrada hasta su salida,
-- incluyendo el estado de garantía y los reclamos asociados.

CREATE TABLE product_serial (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id          BIGINT NOT NULL REFERENCES company(id),
    product_id          BIGINT NOT NULL REFERENCES product(id),
    serial_number       VARCHAR(100) NOT NULL,
    status              VARCHAR(15) NOT NULL DEFAULT 'IN_STOCK',  -- IN_STOCK, SOLD, RETURNED, DEFECTIVE, IN_REPAIR, SCRAPPED
    warehouse_id        BIGINT REFERENCES warehouse(id),         -- ubicación actual (si está en stock)
    -- Trazabilidad de ENTRADA
    goods_receipt_line_id BIGINT REFERENCES goods_receipt_line(id),
    supplier_id         BIGINT REFERENCES partner(id),
    received_date       DATE,
    -- Trazabilidad de SALIDA / VENTA
    invoice_line_id     BIGINT REFERENCES invoice_line(id),
    customer_id         BIGINT REFERENCES partner(id),
    sold_date           DATE,
    -- GARANTÍA
    warranty_months     INT NOT NULL DEFAULT 0,                  -- puede heredar del producto
    warranty_start_date DATE,                                    -- normalmente la fecha de venta
    warranty_end_date   DATE,                                    -- calculada
    notes               VARCHAR(300),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, product_id, serial_number)
);
CREATE INDEX idx_serial_number ON product_serial(serial_number);
CREATE INDEX idx_serial_status ON product_serial(status);
CREATE INDEX idx_serial_customer ON product_serial(customer_id);

CREATE TABLE warranty_claim (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id          BIGINT NOT NULL REFERENCES company(id),
    product_serial_id   BIGINT NOT NULL REFERENCES product_serial(id),
    customer_id         BIGINT REFERENCES partner(id),
    claim_number        VARCHAR(30) NOT NULL,
    claim_date          DATE NOT NULL DEFAULT CURRENT_DATE,
    reported_problem    TEXT NOT NULL,
    status              VARCHAR(15) NOT NULL DEFAULT 'OPEN',     -- OPEN, IN_REVIEW, APPROVED, REJECTED, RESOLVED
    is_under_warranty   BOOLEAN NOT NULL DEFAULT TRUE,           -- dentro del periodo de garantía
    resolution_type     VARCHAR(15),                             -- REPAIR, REPLACE, REFUND, NONE
    replacement_serial_id BIGINT REFERENCES product_serial(id), -- si se reemplaza por otra unidad
    resolution_date     DATE,
    resolution_notes    TEXT,
    assigned_to         BIGINT REFERENCES app_user(id),
    created_by          BIGINT REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, claim_number)
);
CREATE INDEX idx_claim_serial ON warranty_claim(product_serial_id);
CREATE INDEX idx_claim_status ON warranty_claim(status);

-- Movimiento de un serial dentro del kardex (entrada/salida/traspaso/ajuste)
CREATE TABLE stock_movement_serial (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    stock_movement_id   BIGINT NOT NULL REFERENCES stock_movement(id) ON DELETE CASCADE,
    product_serial_id   BIGINT NOT NULL REFERENCES product_serial(id),
    UNIQUE (stock_movement_id, product_serial_id)
);

-- ============================================================================
-- 10. TALLER / SERVICIO TÉCNICO
-- ============================================================================
-- Gestiona la reparación y el servicio de productos, ya sea por garantía
-- (vinculado a warranty_claim) o por cobro. Cada orden de servicio rastrea
-- el equipo recibido, el diagnóstico, los repuestos utilizados y la mano de obra.

CREATE TABLE service_order (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id          BIGINT NOT NULL REFERENCES company(id),
    branch_id           BIGINT REFERENCES branch(id),
    customer_id         BIGINT NOT NULL REFERENCES partner(id),
    order_number        VARCHAR(30) NOT NULL,
    -- Equipo recibido
    product_id          BIGINT REFERENCES product(id),           -- si es un producto del catálogo
    product_serial_id   BIGINT REFERENCES product_serial(id),    -- unidad serializada, si aplica
    item_description    VARCHAR(200),                            -- equipo externo no catalogado
    item_brand          VARCHAR(80),
    item_model          VARCHAR(80),
    item_serial_text    VARCHAR(100),                            -- serial declarado si no está en sistema
    accessories         VARCHAR(300),                            -- lo que entrega el cliente
    -- Garantía
    warranty_claim_id   BIGINT REFERENCES warranty_claim(id),    -- si el servicio es por garantía
    is_warranty         BOOLEAN NOT NULL DEFAULT FALSE,
    -- Flujo
    status              VARCHAR(20) NOT NULL DEFAULT 'RECEIVED', -- RECEIVED, DIAGNOSING, QUOTED, WAITING_APPROVAL, WAITING_PARTS, IN_REPAIR, READY, DELIVERED, CANCELLED
    reported_problem    TEXT NOT NULL,
    diagnosis           TEXT,
    work_performed      TEXT,
    technician_id       BIGINT REFERENCES app_user(id),
    received_date       DATE NOT NULL DEFAULT CURRENT_DATE,
    promised_date       DATE,
    delivered_date      DATE,
    -- Importes (moneda del documento + base)
    currency_code       CHAR(3) NOT NULL DEFAULT 'USD',
    exchange_rate       NUMERIC(18,6) NOT NULL DEFAULT 1,
    parts_total         NUMERIC(18,4) NOT NULL DEFAULT 0,
    labor_total         NUMERIC(18,4) NOT NULL DEFAULT 0,
    tax_amount          NUMERIC(18,4) NOT NULL DEFAULT 0,
    total               NUMERIC(18,4) NOT NULL DEFAULT 0,
    base_total          NUMERIC(18,4) NOT NULL DEFAULT 0,
    invoice_id          BIGINT REFERENCES invoice(id),           -- factura generada al entregar
    notes               VARCHAR(300),
    created_by          BIGINT REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, order_number)
);
CREATE INDEX idx_service_status ON service_order(status);
CREATE INDEX idx_service_customer ON service_order(customer_id);
CREATE INDEX idx_service_technician ON service_order(technician_id);

-- Repuestos / productos consumidos en la reparación (descuentan inventario)
CREATE TABLE service_order_part (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    service_order_id    BIGINT NOT NULL REFERENCES service_order(id) ON DELETE CASCADE,
    product_id          BIGINT NOT NULL REFERENCES product(id),
    warehouse_id        BIGINT REFERENCES warehouse(id),
    product_serial_id   BIGINT REFERENCES product_serial(id),    -- si el repuesto es serializado
    quantity            NUMERIC(18,4) NOT NULL,
    unit_price          NUMERIC(18,4) NOT NULL DEFAULT 0,
    is_billable         BOOLEAN NOT NULL DEFAULT TRUE,           -- FALSE si lo cubre la garantía
    line_total          NUMERIC(18,4) NOT NULL DEFAULT 0
);

-- Mano de obra / servicios aplicados
CREATE TABLE service_order_labor (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    service_order_id    BIGINT NOT NULL REFERENCES service_order(id) ON DELETE CASCADE,
    technician_id       BIGINT REFERENCES app_user(id),
    description         VARCHAR(250) NOT NULL,
    hours               NUMERIC(10,2) NOT NULL DEFAULT 0,
    hourly_rate         NUMERIC(18,4) NOT NULL DEFAULT 0,
    is_billable         BOOLEAN NOT NULL DEFAULT TRUE,
    line_total          NUMERIC(18,4) NOT NULL DEFAULT 0
);

-- Historial de cambios de estado (bitácora del taller)
CREATE TABLE service_status_history (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    service_order_id    BIGINT NOT NULL REFERENCES service_order(id) ON DELETE CASCADE,
    from_status         VARCHAR(20),
    to_status           VARCHAR(20) NOT NULL,
    changed_by          BIGINT REFERENCES app_user(id),
    notes               VARCHAR(300),
    changed_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- FK diferida de invoice -> service_order (declarada arriba como columna)
ALTER TABLE invoice
    ADD CONSTRAINT fk_invoice_service_order
    FOREIGN KEY (service_order_id) REFERENCES service_order(id);

-- ============================================================================
-- 11. FACTURACIÓN ELECTRÓNICA — COSTA RICA (HACIENDA, v4.4 / TRIBU-CR)
-- ============================================================================
-- Homologación al esquema de comprobantes electrónicos versión 4.4, obligatorio
-- desde el 01/09/2025, y a la plataforma TRIBU-CR (reemplazo de ATV, 10/2025).
-- Incluye: catálogo CAByS, actividades económicas (CIIU), clave numérica de 50
-- dígitos, consecutivo de 20 dígitos, tipos de comprobante, referencias entre
-- documentos (NC/ND) y bitácora de transmisión/respuesta de Hacienda.

-- Catálogo oficial de Bienes y Servicios (código de hasta 13 dígitos, obligatorio por línea)
CREATE TABLE cabys (
    code            VARCHAR(13) PRIMARY KEY,
    description     VARCHAR(300) NOT NULL,
    vat_rate        NUMERIC(7,4) NOT NULL DEFAULT 0.13,      -- tarifa IVA asociada
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

-- Catálogo de actividades económicas (CIIU 4) registradas ante Hacienda
CREATE TABLE economic_activity (
    code            VARCHAR(6) PRIMARY KEY,                  -- código de actividad
    description     VARCHAR(250) NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

-- Actividades económicas habilitadas por empresa (una empresa puede tener varias)
CREATE TABLE company_activity (
    company_id      BIGINT NOT NULL REFERENCES company(id),
    activity_code   VARCHAR(6) NOT NULL REFERENCES economic_activity(code),
    is_default      BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (company_id, activity_code)
);

-- Vincular cada producto con su código CAByS
ALTER TABLE product
    ADD COLUMN cabys_code VARCHAR(13) REFERENCES cabys(code);

-- Campos fiscales de Costa Rica en la línea de factura
ALTER TABLE invoice_line
    ADD COLUMN cabys_code VARCHAR(13) REFERENCES cabys(code),
    ADD COLUMN discount_amount NUMERIC(18,4) NOT NULL DEFAULT 0,
    ADD COLUMN exempt_amount  NUMERIC(18,4) NOT NULL DEFAULT 0;

-- Campos fiscales de Costa Rica a nivel de comprobante (sobre la tabla invoice)
ALTER TABLE invoice
    ADD COLUMN document_type        VARCHAR(3)  NOT NULL DEFAULT 'FE',  -- FE, TE, NC, ND, FEC, FEE, REP
    ADD COLUMN ce_clave             CHAR(50),                            -- clave numérica de 50 dígitos
    ADD COLUMN ce_consecutivo       CHAR(20),                            -- consecutivo de 20 dígitos
    ADD COLUMN ce_security_code     CHAR(8),                             -- código de seguridad
    ADD COLUMN ce_situacion         SMALLINT NOT NULL DEFAULT 1,         -- 1 normal, 2 contingencia, 3 sin internet
    ADD COLUMN emitter_activity     VARCHAR(6),                          -- actividad económica del emisor
    ADD COLUMN receiver_activity    VARCHAR(6),                          -- actividad económica del receptor (CIIU 4)
    ADD COLUMN sale_condition       VARCHAR(2)  NOT NULL DEFAULT '01',   -- 01 contado, 02 crédito, ...
    ADD COLUMN payment_method       VARCHAR(2)  NOT NULL DEFAULT '01',   -- 01 efectivo, 02 tarjeta, 04 transferencia...
    ADD COLUMN hacienda_status      VARCHAR(15) NOT NULL DEFAULT 'PENDING', -- PENDING, SIGNED, SENT, ACCEPTED, REJECTED, PARTIAL
    ADD COLUMN signed_xml_url       VARCHAR(400),                        -- XML firmado (almacenamiento)
    ADD COLUMN response_xml_url     VARCHAR(400),                        -- mensaje de respuesta de Hacienda
    ADD COLUMN accepted_at          TIMESTAMPTZ;
CREATE UNIQUE INDEX uq_invoice_clave ON invoice(ce_clave) WHERE ce_clave IS NOT NULL;
CREATE INDEX idx_invoice_hacienda_status ON invoice(hacienda_status);

-- Referencias entre comprobantes (obligatorias en notas de crédito/débito)
CREATE TABLE invoice_reference (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    invoice_id      BIGINT NOT NULL REFERENCES invoice(id) ON DELETE CASCADE,
    ref_document_type VARCHAR(3) NOT NULL,                   -- tipo del documento referenciado
    ref_clave       CHAR(50) NOT NULL,                       -- clave del documento original
    ref_date        TIMESTAMPTZ NOT NULL,
    ref_code        VARCHAR(2) NOT NULL,                     -- 01 anula, 02 corrige texto, 04 referencia otro doc...
    reason          VARCHAR(180) NOT NULL                    -- razón de la referencia
);

-- Recibo Electrónico de Pago (REP) — IVA al cobro de operaciones a crédito
ALTER TABLE payment
    ADD COLUMN generates_rep   BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN rep_clave       CHAR(50),
    ADD COLUMN rep_consecutivo CHAR(20),
    ADD COLUMN rep_status      VARCHAR(15);

-- Bitácora de transmisión hacia Hacienda / TRIBU-CR (auditoría y reintentos)
CREATE TABLE hacienda_transmission (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    invoice_id      BIGINT REFERENCES invoice(id),
    payment_id      BIGINT REFERENCES payment(id),           -- para REP
    document_type   VARCHAR(3) NOT NULL,
    ce_clave        CHAR(50) NOT NULL,
    request_xml     TEXT,                                    -- XML firmado enviado
    response_status VARCHAR(20),                             -- recibido, aceptado, rechazado, procesando
    response_code   VARCHAR(20),
    response_message TEXT,
    attempts        INT NOT NULL DEFAULT 0,
    sent_at         TIMESTAMPTZ,
    responded_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_haci_clave ON hacienda_transmission(ce_clave);
CREATE INDEX idx_haci_status ON hacienda_transmission(response_status);

-- Aceptación de comprobantes RECIBIDos de proveedores (mensaje receptor en TRIBU-CR)
CREATE TABLE received_document (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    supplier_id     BIGINT REFERENCES partner(id),
    ce_clave        CHAR(50) NOT NULL,
    document_type   VARCHAR(3) NOT NULL,
    issue_date      TIMESTAMPTZ,
    total           NUMERIC(18,4),
    currency_code   CHAR(3) DEFAULT 'USD',
    acceptance      VARCHAR(15) NOT NULL DEFAULT 'PENDING',  -- PENDING, ACCEPTED, PARTIAL, REJECTED
    accepted_at     TIMESTAMPTZ,
    xml_url         VARCHAR(400),
    UNIQUE (company_id, ce_clave)
);

-- ============================================================================
-- 12. COTIZACIONES
-- ============================================================================
-- Documento previo a la venta. Puede nacer de una oportunidad de CRM y
-- convertirse en pedido de venta al ser aceptada.

CREATE TABLE quotation (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    branch_id       BIGINT REFERENCES branch(id),
    customer_id     BIGINT REFERENCES partner(id),           -- puede ser prospecto aún sin cliente formal
    opportunity_id  BIGINT REFERENCES crm_opportunity(id),
    quote_number    VARCHAR(30) NOT NULL,
    quote_date      DATE NOT NULL DEFAULT CURRENT_DATE,
    valid_until     DATE,
    status          VARCHAR(15) NOT NULL DEFAULT 'DRAFT',     -- DRAFT, SENT, ACCEPTED, REJECTED, EXPIRED, CONVERTED
    currency_code   CHAR(3) NOT NULL DEFAULT 'USD',
    exchange_rate   NUMERIC(18,6) NOT NULL DEFAULT 1,
    subtotal        NUMERIC(18,4) NOT NULL DEFAULT 0,
    tax_amount      NUMERIC(18,4) NOT NULL DEFAULT 0,
    discount_amount NUMERIC(18,4) NOT NULL DEFAULT 0,
    total           NUMERIC(18,4) NOT NULL DEFAULT 0,
    base_total      NUMERIC(18,4) NOT NULL DEFAULT 0,
    converted_sales_order_id BIGINT REFERENCES sales_order(id), -- pedido generado al aceptar
    notes           VARCHAR(300),
    created_by      BIGINT REFERENCES app_user(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, quote_number)
);
CREATE INDEX idx_quotation_status ON quotation(status);

CREATE TABLE quotation_line (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    quotation_id    BIGINT NOT NULL REFERENCES quotation(id) ON DELETE CASCADE,
    product_id      BIGINT REFERENCES product(id),
    description     VARCHAR(250),
    quantity        NUMERIC(18,4) NOT NULL,
    unit_price      NUMERIC(18,4) NOT NULL,
    discount_rate   NUMERIC(7,4) NOT NULL DEFAULT 0,
    tax_rate        NUMERIC(7,4) NOT NULL DEFAULT 0,
    line_total      NUMERIC(18,4) NOT NULL
);

-- Trazabilidad: el pedido de venta puede originarse de una cotización
ALTER TABLE sales_order
    ADD COLUMN quotation_id BIGINT REFERENCES quotation(id);

-- ============================================================================
-- 13. IMPORTACIÓN DE COMPRAS DESDE XML (factura electrónica del proveedor)
-- ============================================================================
-- Recibe el XML del comprobante del proveedor, lo parsea a líneas, permite
-- mapear cada ítem a un producto del catálogo y generar la orden de compra
-- y/o la recepción de mercancía automáticamente.

ALTER TABLE received_document
    ADD COLUMN subtotal          NUMERIC(18,4),
    ADD COLUMN tax_amount        NUMERIC(18,4),
    ADD COLUMN xml_raw           TEXT,                        -- XML original del proveedor
    ADD COLUMN import_status     VARCHAR(15) NOT NULL DEFAULT 'PENDING', -- PENDING, MAPPED, IMPORTED, IGNORED
    ADD COLUMN purchase_order_id BIGINT REFERENCES purchase_order(id);   -- OC generada desde el XML

CREATE TABLE received_document_line (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    received_document_id BIGINT NOT NULL REFERENCES received_document(id) ON DELETE CASCADE,
    line_number         INT,
    cabys_code          VARCHAR(13),
    supplier_item_code  VARCHAR(60),                          -- código del proveedor en el XML
    description         VARCHAR(250),
    quantity            NUMERIC(18,4) NOT NULL,
    unit                VARCHAR(15),
    unit_cost           NUMERIC(18,4) NOT NULL,
    tax_rate            NUMERIC(7,4) NOT NULL DEFAULT 0,
    line_total          NUMERIC(18,4) NOT NULL,
    mapped_product_id   BIGINT REFERENCES product(id)         -- producto del catálogo (al mapear)
);
CREATE INDEX idx_recdoc_line_doc ON received_document_line(received_document_id);

-- Reglas de mapeo reutilizables: código de proveedor/CAByS -> producto
CREATE TABLE supplier_product_map (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    supplier_id     BIGINT NOT NULL REFERENCES partner(id),
    supplier_item_code VARCHAR(60) NOT NULL,
    product_id      BIGINT NOT NULL REFERENCES product(id),
    UNIQUE (company_id, supplier_id, supplier_item_code)
);

-- ============================================================================
-- 14. CRM (AMPLIACIÓN)
-- ============================================================================
-- Amplía el CRM básico con prospectos (leads), múltiples embudos (pipelines)
-- y campos de origen y motivo de pérdida en las oportunidades.

CREATE TABLE crm_pipeline (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    name            VARCHAR(80) NOT NULL,                     -- "Ventas", "Posventa", "Mayoreo"
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (company_id, name)
);

-- Asociar etapas a un embudo
ALTER TABLE crm_stage
    ADD COLUMN pipeline_id BIGINT REFERENCES crm_pipeline(id);

-- Origen y motivo de pérdida en oportunidades
ALTER TABLE crm_opportunity
    ADD COLUMN pipeline_id BIGINT REFERENCES crm_pipeline(id),
    ADD COLUMN source      VARCHAR(40),                       -- web, referido, redes, llamada, feria...
    ADD COLUMN lost_reason VARCHAR(150);

CREATE TABLE crm_lead (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    name            VARCHAR(150) NOT NULL,                    -- nombre del contacto
    company_name    VARCHAR(200),
    email           VARCHAR(150),
    phone           VARCHAR(50),
    source          VARCHAR(40),                              -- canal de origen
    status          VARCHAR(15) NOT NULL DEFAULT 'NEW',       -- NEW, CONTACTED, QUALIFIED, CONVERTED, LOST
    owner_user_id   BIGINT REFERENCES app_user(id),
    notes           TEXT,
    converted_partner_id     BIGINT REFERENCES partner(id),         -- cliente creado al convertir
    converted_opportunity_id BIGINT REFERENCES crm_opportunity(id), -- oportunidad creada al convertir
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_lead_status ON crm_lead(status);
CREATE INDEX idx_lead_owner ON crm_lead(owner_user_id);

-- ============================================================================
-- 15. TALLER — AGENDA, NOTIFICACIONES, BITÁCORA Y SLA
-- ============================================================================

-- Política de SLA: tiempo objetivo de proceso por prioridad/tipo (base del semáforo)
CREATE TABLE service_sla_policy (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    name            VARCHAR(80) NOT NULL,                     -- "Normal", "Express", "Garantía"
    priority        VARCHAR(10) NOT NULL DEFAULT 'NORMAL',    -- LOW, NORMAL, HIGH, URGENT
    sla_hours       INT NOT NULL,                             -- horas objetivo de resolución
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (company_id, name)
);

-- Campos de agenda y SLA sobre la orden de servicio
ALTER TABLE service_order
    ADD COLUMN priority      VARCHAR(10) NOT NULL DEFAULT 'NORMAL',  -- LOW, NORMAL, HIGH, URGENT
    ADD COLUMN sla_policy_id BIGINT REFERENCES service_sla_policy(id),
    ADD COLUMN sla_hours     INT,                              -- objetivo aplicado (copiado de la política)
    ADD COLUMN check_in_at   TIMESTAMPTZ,                      -- momento real del ingreso del equipo
    ADD COLUMN due_at        TIMESTAMPTZ;                      -- fecha/hora límite calculada

-- Agenda de citas (programación de ingreso de equipos y trabajo del taller)
CREATE TABLE service_appointment (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id          BIGINT NOT NULL REFERENCES company(id),
    branch_id           BIGINT REFERENCES branch(id),
    customer_id         BIGINT REFERENCES partner(id),
    service_order_id    BIGINT REFERENCES service_order(id),   -- se enlaza al ingresar el equipo
    technician_id       BIGINT REFERENCES app_user(id),
    title               VARCHAR(150) NOT NULL,                 -- "Ingreso laptop · Juan Pérez"
    item_description    VARCHAR(200),
    scheduled_start     TIMESTAMPTZ NOT NULL,
    scheduled_end       TIMESTAMPTZ,
    status              VARCHAR(15) NOT NULL DEFAULT 'SCHEDULED', -- SCHEDULED, CONFIRMED, CHECKED_IN, DONE, CANCELLED, NO_SHOW
    notes               VARCHAR(300),
    created_by          BIGINT REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_appt_start ON service_appointment(scheduled_start);
CREATE INDEX idx_appt_tech ON service_appointment(technician_id, scheduled_start);

-- Bitácora del proceso (entradas libres además del historial de estados)
CREATE TABLE service_order_log (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    service_order_id    BIGINT NOT NULL REFERENCES service_order(id) ON DELETE CASCADE,
    user_id             BIGINT REFERENCES app_user(id),
    entry_type          VARCHAR(20) NOT NULL DEFAULT 'NOTE',   -- NOTE, DIAGNOSIS, CALL, PART_REQUEST, PHOTO, STATUS, CUSTOMER_MSG
    description         TEXT NOT NULL,
    attachment_url      VARCHAR(400),                          -- foto/evidencia opcional
    is_visible_customer BOOLEAN NOT NULL DEFAULT FALSE,        -- compartible con el cliente
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_solog_order ON service_order_log(service_order_id, created_at);

-- Plantillas de notificación (WhatsApp / Email / SMS) por evento
CREATE TABLE notification_template (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    code            VARCHAR(40) NOT NULL,                      -- INGRESO, DIAGNOSTICO, LISTO, ENTREGADO...
    channel         VARCHAR(10) NOT NULL,                      -- WHATSAPP, EMAIL, SMS
    event           VARCHAR(30) NOT NULL,                      -- evento que la dispara
    subject         VARCHAR(200),                              -- para email
    body            TEXT NOT NULL,                             -- con marcadores {{cliente}}, {{orden}}...
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (company_id, code, channel)
);

-- Bitácora de mensajes enviados (envío y estado de entrega)
CREATE TABLE notification_message (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id          BIGINT NOT NULL REFERENCES company(id),
    channel             VARCHAR(10) NOT NULL,                  -- WHATSAPP, EMAIL, SMS
    template_id         BIGINT REFERENCES notification_template(id),
    service_order_id    BIGINT REFERENCES service_order(id),   -- contexto (opcional)
    customer_id         BIGINT REFERENCES partner(id),
    recipient           VARCHAR(150) NOT NULL,                 -- número o correo destino
    subject             VARCHAR(200),
    body                TEXT NOT NULL,
    status              VARCHAR(12) NOT NULL DEFAULT 'QUEUED', -- QUEUED, SENT, DELIVERED, READ, FAILED
    provider_message_id VARCHAR(120),                          -- id del proveedor (WhatsApp/email)
    error               VARCHAR(300),
    queued_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at             TIMESTAMPTZ,
    delivered_at        TIMESTAMPTZ
);
CREATE INDEX idx_notif_status ON notification_message(status);
CREATE INDEX idx_notif_order ON notification_message(service_order_id);

-- ============================================================================
-- 16. CANAL WEB / E-COMMERCE E INTEGRACIÓN DE PAGOS
-- ============================================================================
-- La página web (desarrollo propio) consume la API de comercio del ERP para
-- validar precios y stock, y enviar el pedido del carrito. El pedido se crea
-- pendiente de validación; tras revisar inventario se genera un enlace de pago
-- BAC compraCLICK y, al confirmarse el pago, se factura.

-- Identificación del origen del pedido y referencia externa de la web
ALTER TABLE sales_order
    ADD COLUMN channel       VARCHAR(10) NOT NULL DEFAULT 'POS',  -- POS, WEB, PHONE, MANUAL
    ADD COLUMN external_ref  VARCHAR(60),                          -- id del pedido en la web
    ADD COLUMN web_status    VARCHAR(15);                          -- RECEIVED, VALIDATED, AWAIT_PAYMENT, PAID, REJECTED

-- Clientes de API (la web y otros sistemas que consumen la API del ERP)
CREATE TABLE api_client (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    name            VARCHAR(100) NOT NULL,                         -- "Sitio web", "App móvil"
    client_key      VARCHAR(80) NOT NULL UNIQUE,
    secret_hash     VARCHAR(255) NOT NULL,
    scopes          VARCHAR(300),                                  -- catalog:read, orders:write...
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enlaces de pago (BAC compraCLICK u otra pasarela)
CREATE TABLE payment_link (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id          BIGINT NOT NULL REFERENCES company(id),
    sales_order_id      BIGINT REFERENCES sales_order(id),
    invoice_id          BIGINT REFERENCES invoice(id),             -- se enlaza al facturar
    provider            VARCHAR(20) NOT NULL DEFAULT 'BAC_COMPRACLICK',
    amount              NUMERIC(18,4) NOT NULL,
    currency_code       CHAR(3) NOT NULL DEFAULT 'USD',
    description         VARCHAR(200),
    link_url            VARCHAR(400),
    recipient_email     VARCHAR(150),
    recipient_phone     VARCHAR(50),
    sent_channel        VARCHAR(10),                               -- EMAIL, SMS, WHATSAPP
    status              VARCHAR(12) NOT NULL DEFAULT 'CREATED',    -- CREATED, SENT, PAID, EXPIRED, CANCELLED, FAILED
    provider_ref        VARCHAR(120),                              -- referencia/transacción de BAC
    authorization_code  VARCHAR(40),
    paid_at             TIMESTAMPTZ,
    expires_at          TIMESTAMPTZ,
    created_by          BIGINT REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_paylink_status ON payment_link(status);
CREATE INDEX idx_paylink_order ON payment_link(sales_order_id);

-- Bitácora de eventos entrantes (webhooks de pago) con idempotencia
CREATE TABLE webhook_event (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    source          VARCHAR(20) NOT NULL,                          -- BAC, WEB, ...
    event_type      VARCHAR(40) NOT NULL,                          -- payment.approved, payment.failed...
    external_id     VARCHAR(120),                                  -- id del evento (idempotencia)
    payload         JSONB,
    processed       BOOLEAN NOT NULL DEFAULT FALSE,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source, external_id)
);

-- Publicación de productos en la tienda web (elegir qué se ve en el site)
ALTER TABLE product
    ADD COLUMN web_published     BOOLEAN NOT NULL DEFAULT FALSE,  -- visible en la tienda
    ADD COLUMN web_featured      BOOLEAN NOT NULL DEFAULT FALSE,  -- destacado
    ADD COLUMN web_title         VARCHAR(200),                    -- título para la web (SEO)
    ADD COLUMN web_description   TEXT,
    ADD COLUMN web_slug          VARCHAR(150),                    -- URL amigable
    ADD COLUMN web_price_list_id BIGINT REFERENCES price_list(id); -- lista de precios del canal web
CREATE UNIQUE INDEX uq_product_web_slug ON product(company_id, web_slug) WHERE web_slug IS NOT NULL;
CREATE INDEX idx_product_web_pub ON product(web_published) WHERE web_published = TRUE;

-- Galería de imágenes del producto (para la tienda web)
CREATE TABLE product_image (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id  BIGINT NOT NULL REFERENCES product(id) ON DELETE CASCADE,
    url         VARCHAR(400) NOT NULL,
    alt_text    VARCHAR(200),
    sort_order  INT NOT NULL DEFAULT 0,
    is_primary  BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX idx_prodimg_product ON product_image(product_id);

-- ============================================================================
-- 17. CRM — TICKETS (oportunidades, soporte, proyectos, inventario en tránsito)
-- ============================================================================
-- Sistema de tickets unificado para el servicio técnico B2B de MundoTec. Un
-- ticket clasifica su tipo y reutiliza embudos/etapas del CRM; cada tipo tiene
-- sus extensiones (SLA para soporte, tareas para proyectos, tránsito para
-- inventario).

CREATE TABLE ticket_category (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    ticket_type     VARCHAR(20) NOT NULL,                     -- OPPORTUNITY, SUPPORT, PROJECT, INVENTORY_TRANSIT
    name            VARCHAR(80) NOT NULL,                     -- "Hardware", "Red", "Garantía"...
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (company_id, ticket_type, name)
);

CREATE TABLE ticket (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    branch_id       BIGINT REFERENCES branch(id),
    ticket_number   VARCHAR(30) NOT NULL,
    ticket_type     VARCHAR(20) NOT NULL,                     -- OPPORTUNITY, SUPPORT, PROJECT, INVENTORY_TRANSIT
    category_id     BIGINT REFERENCES ticket_category(id),
    subject         VARCHAR(200) NOT NULL,
    description     TEXT,
    -- Empresa/contacto
    partner_id      BIGINT REFERENCES partner(id),            -- empresa cliente
    contact_id      BIGINT REFERENCES partner_contact(id),
    -- Flujo / tablero (reutiliza el CRM)
    pipeline_id     BIGINT REFERENCES crm_pipeline(id),
    stage_id        BIGINT REFERENCES crm_stage(id),
    priority        VARCHAR(10) NOT NULL DEFAULT 'NORMAL',    -- LOW, NORMAL, HIGH, URGENT
    status          VARCHAR(15) NOT NULL DEFAULT 'OPEN',      -- OPEN, IN_PROGRESS, WAITING, RESOLVED, CLOSED, CANCELLED
    assigned_to     BIGINT REFERENCES app_user(id),
    source          VARCHAR(20),                              -- EMAIL, PHONE, WEB, WHATSAPP, PRESENCIAL
    -- SLA (semáforo de soporte)
    sla_policy_id   BIGINT REFERENCES service_sla_policy(id),
    sla_hours       INT,
    due_at          TIMESTAMPTZ,
    first_response_at TIMESTAMPTZ,
    -- Vínculos cruzados según el tipo
    opportunity_id  BIGINT REFERENCES crm_opportunity(id),    -- type = OPPORTUNITY
    service_order_id BIGINT REFERENCES service_order(id),     -- soporte que pasa a taller
    quotation_id    BIGINT REFERENCES quotation(id),
    -- Auditoría
    created_by      BIGINT REFERENCES app_user(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at       TIMESTAMPTZ,
    UNIQUE (company_id, ticket_number)
);
CREATE INDEX idx_ticket_type ON ticket(ticket_type);
CREATE INDEX idx_ticket_status ON ticket(status);
CREATE INDEX idx_ticket_partner ON ticket(partner_id);
CREATE INDEX idx_ticket_assigned ON ticket(assigned_to);

-- Conversación / bitácora del ticket
CREATE TABLE ticket_comment (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ticket_id       BIGINT NOT NULL REFERENCES ticket(id) ON DELETE CASCADE,
    user_id         BIGINT REFERENCES app_user(id),
    body            TEXT NOT NULL,
    is_internal     BOOLEAN NOT NULL DEFAULT FALSE,           -- interno vs visible al cliente
    attachment_url  VARCHAR(400),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tcomment_ticket ON ticket_comment(ticket_id, created_at);

-- Historial de cambios de estado del ticket
CREATE TABLE ticket_status_history (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ticket_id       BIGINT NOT NULL REFERENCES ticket(id) ON DELETE CASCADE,
    from_status     VARCHAR(15),
    to_status       VARCHAR(15) NOT NULL,
    changed_by      BIGINT REFERENCES app_user(id),
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Extensión PROYECTOS: tareas del ticket de tipo PROJECT
CREATE TABLE project_task (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ticket_id       BIGINT NOT NULL REFERENCES ticket(id) ON DELETE CASCADE,
    name            VARCHAR(200) NOT NULL,
    assigned_to     BIGINT REFERENCES app_user(id),
    status          VARCHAR(15) NOT NULL DEFAULT 'TODO',      -- TODO, IN_PROGRESS, DONE, BLOCKED
    start_date      DATE,
    due_date        DATE,
    progress_pct    NUMERIC(5,2) NOT NULL DEFAULT 0,
    sort_order      INT NOT NULL DEFAULT 0
);
CREATE INDEX idx_ptask_ticket ON project_task(ticket_id);

-- Extensión INVENTARIO-TRÁNSITO: seguimiento de mercancía en camino
CREATE TABLE inventory_transit (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id          BIGINT NOT NULL REFERENCES company(id),
    ticket_id           BIGINT REFERENCES ticket(id),
    reference           VARCHAR(40),                          -- guía / referencia
    origin              VARCHAR(150),                         -- proveedor / origen
    destination_warehouse_id BIGINT REFERENCES warehouse(id),
    carrier             VARCHAR(100),
    tracking_number     VARCHAR(80),
    status              VARCHAR(15) NOT NULL DEFAULT 'PENDING', -- PENDING, IN_TRANSIT, CUSTOMS, DELAYED, RECEIVED, CANCELLED
    eta_date            DATE,
    received_date       DATE,
    purchase_order_id   BIGINT REFERENCES purchase_order(id), -- compra asociada (si aplica)
    notes               VARCHAR(300),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_transit_status ON inventory_transit(status);

CREATE TABLE inventory_transit_line (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    inventory_transit_id BIGINT NOT NULL REFERENCES inventory_transit(id) ON DELETE CASCADE,
    product_id          BIGINT REFERENCES product(id),
    description         VARCHAR(200),
    quantity            NUMERIC(18,4) NOT NULL,
    received_qty        NUMERIC(18,4) NOT NULL DEFAULT 0
);

-- ============================================================================
-- 18. MEJORAS DE MÓDULOS (cotizaciones, POS/bancos, compras, inventario)
-- ============================================================================

-- --- 18.1 Cotizaciones: costos, márgenes y ajustes -------------------------
ALTER TABLE quotation
    ADD COLUMN cost_total          NUMERIC(18,4) NOT NULL DEFAULT 0,  -- costo total
    ADD COLUMN margin_amount       NUMERIC(18,4) NOT NULL DEFAULT 0,  -- utilidad
    ADD COLUMN margin_pct          NUMERIC(7,4)  NOT NULL DEFAULT 0,  -- % de margen
    ADD COLUMN global_adjust_type  VARCHAR(12),                       -- PERCENT, AMOUNT, TARGET_MARGIN
    ADD COLUMN global_adjust_value NUMERIC(18,4),                     -- valor del ajuste global
    ADD COLUMN sent_at             TIMESTAMPTZ,                       -- fecha de envío por email
    ADD COLUMN sent_to_email       VARCHAR(150),
    ADD COLUMN sales_stage         VARCHAR(20);                       -- etapa del proceso de venta

ALTER TABLE quotation_line
    ADD COLUMN unit_cost      NUMERIC(18,4) NOT NULL DEFAULT 0,       -- costo unitario
    ADD COLUMN margin_amount  NUMERIC(18,4) NOT NULL DEFAULT 0,       -- utilidad de la línea
    ADD COLUMN margin_pct     NUMERIC(7,4)  NOT NULL DEFAULT 0;       -- % margen de la línea

-- --- 18.2 Bancos y medios de pago (POS ágil) -------------------------------
CREATE TABLE bank_account (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    bank_name       VARCHAR(100) NOT NULL,                            -- BAC, BN, BCR...
    alias           VARCHAR(80),                                      -- "BAC colones ventas"
    account_number  VARCHAR(40),
    currency_code   CHAR(3) NOT NULL DEFAULT 'CRC',
    account_type    VARCHAR(15) NOT NULL DEFAULT 'CHECKING',          -- CHECKING, SAVINGS, CARD_ACQUIRER, CASH
    gl_account_id   BIGINT REFERENCES account(id),                    -- cuenta contable asociada
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (company_id, bank_name, account_number)
);

-- Configuración de cada medio de pago ligado a su banco/cuenta (clave del POS)
CREATE TABLE payment_method_config (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    method          VARCHAR(15) NOT NULL,                             -- CASH, CARD, TRANSFER, SINPE, CHECK
    label           VARCHAR(60) NOT NULL,                             -- "Tarjeta BAC", "SINPE Móvil"
    bank_account_id BIGINT REFERENCES bank_account(id),              -- banco donde entra el dinero
    acquirer        VARCHAR(40),                                      -- adquirente de tarjeta (BAC...)
    surcharge_pct   NUMERIC(7,4) NOT NULL DEFAULT 0,                  -- comisión, si aplica
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order      INT NOT NULL DEFAULT 0,
    UNIQUE (company_id, method, label)
);

-- Caja registradora y sesión/turno (cierre de caja del POS)
CREATE TABLE cash_register (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    branch_id       BIGINT REFERENCES branch(id),
    name            VARCHAR(60) NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE pos_session (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    cash_register_id BIGINT NOT NULL REFERENCES cash_register(id),
    user_id         BIGINT REFERENCES app_user(id),
    opened_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at       TIMESTAMPTZ,
    opening_amount  NUMERIC(18,4) NOT NULL DEFAULT 0,
    closing_amount  NUMERIC(18,4),
    status          VARCHAR(10) NOT NULL DEFAULT 'OPEN'               -- OPEN, CLOSED
);

-- Enlazar el pago con su banco/medio y la sesión de caja
ALTER TABLE payment
    ADD COLUMN bank_account_id BIGINT REFERENCES bank_account(id),
    ADD COLUMN method_config_id BIGINT REFERENCES payment_method_config(id),
    ADD COLUMN pos_session_id  BIGINT REFERENCES pos_session(id),
    ADD COLUMN card_last4      VARCHAR(4),
    ADD COLUMN auth_code       VARCHAR(40);

-- --- 18.3 Compras: ajuste de precios e historial --------------------------
CREATE TABLE product_price_history (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    product_id      BIGINT NOT NULL REFERENCES product(id),
    change_type     VARCHAR(10) NOT NULL,                             -- COST, SALE
    old_value       NUMERIC(18,4),
    new_value       NUMERIC(18,4) NOT NULL,
    source          VARCHAR(15),                                      -- PURCHASE, IMPORT_XML, MANUAL
    source_id       BIGINT,
    changed_by      BIGINT REFERENCES app_user(id),
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pricehist_product ON product_price_history(product_id, changed_at);

-- Al importar XML / recibir, sugerir actualización de costo y precio de venta
ALTER TABLE received_document_line
    ADD COLUMN update_cost        BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN suggested_sale_price NUMERIC(18,4),
    ADD COLUMN serials_captured   INT NOT NULL DEFAULT 0;             -- nº de seriales ingresados

-- --- 18.4 Inventario: departamentos, proveedor y ajustes ------------------
CREATE TABLE department (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    name            VARCHAR(80) NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (company_id, name)
);

ALTER TABLE product
    ADD COLUMN department_id       BIGINT REFERENCES department(id),
    ADD COLUMN default_supplier_id BIGINT REFERENCES partner(id);

-- Documento de ajuste de existencias (conteo / corrección)
CREATE TABLE inventory_adjustment (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id          BIGINT NOT NULL REFERENCES company(id),
    warehouse_id        BIGINT NOT NULL REFERENCES warehouse(id),
    adjustment_number   VARCHAR(30) NOT NULL,
    adjustment_date     DATE NOT NULL DEFAULT CURRENT_DATE,
    reason              VARCHAR(120),                                 -- conteo físico, merma, daño...
    -- Filtros usados para armar el ajuste (agilizan el proceso)
    filter_department_id BIGINT REFERENCES department(id),
    filter_supplier_id   BIGINT REFERENCES partner(id),
    filter_sold_only     BOOLEAN NOT NULL DEFAULT FALSE,             -- solo productos vendidos
    status              VARCHAR(12) NOT NULL DEFAULT 'DRAFT',         -- DRAFT, CONFIRMED, CANCELLED
    created_by          BIGINT REFERENCES app_user(id),
    confirmed_by        BIGINT REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at        TIMESTAMPTZ,
    UNIQUE (company_id, adjustment_number)
);
CREATE INDEX idx_adj_status ON inventory_adjustment(status);

CREATE TABLE inventory_adjustment_line (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    inventory_adjustment_id BIGINT NOT NULL REFERENCES inventory_adjustment(id) ON DELETE CASCADE,
    product_id          BIGINT NOT NULL REFERENCES product(id),
    system_qty          NUMERIC(18,4) NOT NULL DEFAULT 0,            -- existencia en sistema
    counted_qty         NUMERIC(18,4) NOT NULL DEFAULT 0,            -- existencia contada
    diff_qty            NUMERIC(18,4) NOT NULL DEFAULT 0,            -- diferencia (counted - system)
    unit_cost           NUMERIC(18,4) NOT NULL DEFAULT 0,
    note                VARCHAR(200)
);
CREATE INDEX idx_adjline_adj ON inventory_adjustment_line(inventory_adjustment_id);

-- ============================================================================
-- 19. CIERRE DE CAJA (arqueo del POS)
-- ============================================================================
-- Amplía pos_session con el arqueo de cierre: comparación de lo esperado vs.
-- lo contado por medio de pago, conteo de denominaciones, movimientos de
-- efectivo del turno y depósito bancario.

ALTER TABLE pos_session
    ADD COLUMN expected_cash    NUMERIC(18,4),                  -- efectivo esperado al cierre
    ADD COLUMN counted_cash     NUMERIC(18,4),                  -- efectivo contado
    ADD COLUMN cash_difference  NUMERIC(18,4),                  -- sobrante (+) / faltante (-)
    ADD COLUMN deposit_bank_account_id BIGINT REFERENCES bank_account(id), -- depósito del efectivo
    ADD COLUMN deposit_amount   NUMERIC(18,4),
    ADD COLUMN closed_by        BIGINT REFERENCES app_user(id),
    ADD COLUMN notes            VARCHAR(300);

-- Arqueo por medio de pago (efectivo, tarjeta, transferencia, SINPE...)
CREATE TABLE cash_closing_line (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pos_session_id  BIGINT NOT NULL REFERENCES pos_session(id) ON DELETE CASCADE,
    method          VARCHAR(15) NOT NULL,                       -- CASH, CARD, TRANSFER, SINPE, CHECK
    expected_amount NUMERIC(18,4) NOT NULL DEFAULT 0,           -- según el sistema
    counted_amount  NUMERIC(18,4) NOT NULL DEFAULT 0,           -- según el arqueo
    difference      NUMERIC(18,4) NOT NULL DEFAULT 0,           -- counted - expected
    UNIQUE (pos_session_id, method)
);

-- Conteo de denominaciones de efectivo
CREATE TABLE cash_count_denomination (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pos_session_id  BIGINT NOT NULL REFERENCES pos_session(id) ON DELETE CASCADE,
    denomination    NUMERIC(12,2) NOT NULL,                     -- 20000, 10000, 1000, 100...
    quantity        INT NOT NULL DEFAULT 0,
    subtotal        NUMERIC(18,4) NOT NULL DEFAULT 0
);

-- Movimientos de efectivo durante el turno (ingresos/retiros)
CREATE TABLE cash_movement (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pos_session_id  BIGINT NOT NULL REFERENCES pos_session(id) ON DELETE CASCADE,
    movement_type   VARCHAR(12) NOT NULL,                       -- CASH_IN, CASH_OUT, PAYOUT, DROP, DEPOSIT
    amount          NUMERIC(18,4) NOT NULL,
    reason          VARCHAR(200),
    created_by      BIGINT REFERENCES app_user(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cashmov_session ON cash_movement(pos_session_id);

-- ============================================================================
-- 20. CARACTERÍSTICAS DE LOS SISTEMAS ACTUALES + MEJORAS
-- ============================================================================
-- Incorpora capacidades observadas en Reportes-Syma (en producción) y mejoras:
-- vendedores y comisiones, categoría de cliente, devoluciones, promociones y
-- preparación/empaque de pedidos.

-- --- 20.1 Vendedores y comisiones -----------------------------------------
ALTER TABLE app_user
    ADD COLUMN is_salesperson  BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN commission_pct  NUMERIC(7,4) NOT NULL DEFAULT 0;     -- % comisión por defecto

ALTER TABLE sales_order  ADD COLUMN salesperson_id BIGINT REFERENCES app_user(id);
ALTER TABLE invoice      ADD COLUMN salesperson_id BIGINT REFERENCES app_user(id);
ALTER TABLE quotation    ADD COLUMN salesperson_id BIGINT REFERENCES app_user(id);

CREATE TABLE commission (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    salesperson_id  BIGINT NOT NULL REFERENCES app_user(id),
    source_type     VARCHAR(10) NOT NULL,                           -- SALE, SERVICE
    source_id       BIGINT,                                         -- factura u orden de servicio
    base_amount     NUMERIC(18,4) NOT NULL DEFAULT 0,
    rate            NUMERIC(7,4)  NOT NULL DEFAULT 0,
    amount          NUMERIC(18,4) NOT NULL DEFAULT 0,
    period          VARCHAR(10),                                    -- 2026-06
    status          VARCHAR(10) NOT NULL DEFAULT 'PENDING',         -- PENDING, APPROVED, PAID
    paid_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_commission_sp ON commission(salesperson_id, period);

-- --- 20.2 Categoría / clase de cliente (A, B, C, D, E) --------------------
CREATE TABLE customer_category (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    code            VARCHAR(5) NOT NULL,                            -- A, B, C, D, E
    name            VARCHAR(80) NOT NULL,
    UNIQUE (company_id, code)
);
ALTER TABLE partner ADD COLUMN customer_category_id BIGINT REFERENCES customer_category(id);

-- --- 20.3 Devoluciones de venta -------------------------------------------
CREATE TABLE sales_return (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    branch_id       BIGINT REFERENCES branch(id),
    invoice_id      BIGINT REFERENCES invoice(id),                  -- factura origen
    customer_id     BIGINT NOT NULL REFERENCES partner(id),
    return_number   VARCHAR(30) NOT NULL,
    return_date     DATE NOT NULL DEFAULT CURRENT_DATE,
    reason          VARCHAR(150),
    restock         BOOLEAN NOT NULL DEFAULT TRUE,                  -- reingresa a inventario
    status          VARCHAR(12) NOT NULL DEFAULT 'DRAFT',           -- DRAFT, CONFIRMED, CANCELLED
    credit_note_id  BIGINT REFERENCES invoice(id),                  -- NC generada (document_type=NC)
    total           NUMERIC(18,4) NOT NULL DEFAULT 0,
    created_by      BIGINT REFERENCES app_user(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, return_number)
);

CREATE TABLE sales_return_line (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sales_return_id   BIGINT NOT NULL REFERENCES sales_return(id) ON DELETE CASCADE,
    product_id        BIGINT NOT NULL REFERENCES product(id),
    product_serial_id BIGINT REFERENCES product_serial(id),
    quantity          NUMERIC(18,4) NOT NULL,
    unit_price        NUMERIC(18,4) NOT NULL,
    line_total        NUMERIC(18,4) NOT NULL
);

-- --- 20.4 Promociones / ofertas (interna y web) ---------------------------
CREATE TABLE promotion (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    name            VARCHAR(120) NOT NULL,
    promo_type      VARCHAR(10) NOT NULL,                           -- PERCENT, FIXED, PRICE
    value           NUMERIC(18,4) NOT NULL,
    scope           VARCHAR(10) NOT NULL DEFAULT 'PRODUCT',         -- PRODUCT, CATEGORY, ALL
    start_date      DATE,
    end_date        DATE,
    is_web          BOOLEAN NOT NULL DEFAULT FALSE,                 -- visible como "Oferta" en la tienda
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE promotion_product (
    promotion_id    BIGINT NOT NULL REFERENCES promotion(id) ON DELETE CASCADE,
    product_id      BIGINT NOT NULL REFERENCES product(id),
    PRIMARY KEY (promotion_id, product_id)
);

-- --- 20.5 Preparación / empaque de pedidos (previo de empaque) ------------
CREATE TABLE dispatch_note (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    sales_order_id  BIGINT REFERENCES sales_order(id),
    dispatch_number VARCHAR(30) NOT NULL,
    status          VARCHAR(12) NOT NULL DEFAULT 'PENDING',         -- PENDING, PACKED, DISPATCHED, DELIVERED
    packed_by       BIGINT REFERENCES app_user(id),
    packed_at       TIMESTAMPTZ,
    notes           VARCHAR(300),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, dispatch_number)
);

CREATE TABLE dispatch_note_line (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    dispatch_note_id BIGINT NOT NULL REFERENCES dispatch_note(id) ON DELETE CASCADE,
    product_id      BIGINT NOT NULL REFERENCES product(id),
    quantity        NUMERIC(18,4) NOT NULL,
    picked_qty      NUMERIC(18,4) NOT NULL DEFAULT 0
);

-- Taller: ubicación del servicio y % de comisión del técnico
ALTER TABLE service_order
    ADD COLUMN location VARCHAR(150),
    ADD COLUMN technician_commission_pct NUMERIC(7,4) NOT NULL DEFAULT 0;

-- ============================================================================
-- 21. CANAL WEB — DATOS PROPIOS DE LA TIENDA
-- ============================================================================
-- Tablas que pertenecen SOLO al storefront (no al núcleo del ERP): cuentas de
-- cliente web, carrito, lista de deseos y contenido (proyectos, servicios,
-- banners). El catálogo, precios, stock, pedidos y pagos siguen viniendo del
-- dominio compartido del ERP.

-- Cuenta de cliente de la tienda (login público; distinto de app_user interno)
CREATE TABLE web_customer (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    partner_id      BIGINT REFERENCES partner(id),                  -- se enlaza/crea al comprar
    email           VARCHAR(150) NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    full_name       VARCHAR(150),
    phone           VARCHAR(50),
    is_verified     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at   TIMESTAMPTZ,
    UNIQUE (company_id, email)
);

-- Carrito (persistente entre sesiones); se convierte en sales_order al confirmar
CREATE TABLE cart (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    web_customer_id BIGINT REFERENCES web_customer(id),            -- NULL = invitado
    session_token   VARCHAR(80),                                   -- carrito anónimo
    status          VARCHAR(12) NOT NULL DEFAULT 'ACTIVE',         -- ACTIVE, CONVERTED, ABANDONED
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cart_customer ON cart(web_customer_id);

CREATE TABLE cart_item (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cart_id         BIGINT NOT NULL REFERENCES cart(id) ON DELETE CASCADE,
    product_id      BIGINT NOT NULL REFERENCES product(id),
    quantity        NUMERIC(18,4) NOT NULL DEFAULT 1,
    unit_price_snapshot NUMERIC(18,4),                             -- precio al agregar (referencia)
    UNIQUE (cart_id, product_id)
);

CREATE TABLE wishlist (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    web_customer_id BIGINT NOT NULL REFERENCES web_customer(id) ON DELETE CASCADE,
    product_id      BIGINT NOT NULL REFERENCES product(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (web_customer_id, product_id)
);

-- Contenido editorial de la tienda (no es dominio del ERP)
CREATE TABLE web_project (                                          -- "Proyectos realizados"
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    title           VARCHAR(200) NOT NULL,
    category        VARCHAR(60),                                   -- SEGURIDAD, NETWORKING...
    description     TEXT,
    cover_image_url VARCHAR(400),
    sort_order      INT NOT NULL DEFAULT 0,
    is_published    BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE web_service (                                          -- "Nuestros Servicios"
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    title           VARCHAR(150) NOT NULL,
    description     TEXT,
    icon            VARCHAR(40),
    sort_order      INT NOT NULL DEFAULT 0,
    is_published    BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE web_banner (                                           -- carrusel / promos visuales
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    title           VARCHAR(150),
    image_url       VARCHAR(400) NOT NULL,
    link_url        VARCHAR(400),
    sort_order      INT NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

-- ============================================================================
-- 22. VISTAS DE APOYO
-- ============================================================================

-- Saldo de cuentas por cobrar por cliente
CREATE VIEW v_accounts_receivable AS
SELECT i.company_id,
       i.customer_id,
       p.legal_name AS customer_name,
       SUM(i.balance) AS total_balance
FROM invoice i
JOIN partner p ON p.id = i.customer_id
WHERE i.status IN ('ISSUED','PARTIAL')
GROUP BY i.company_id, i.customer_id, p.legal_name;

-- Productos por debajo del stock mínimo
CREATE VIEW v_low_stock AS
SELECT s.product_id,
       pr.sku,
       pr.name,
       s.warehouse_id,
       s.quantity,
       pr.min_stock
FROM stock s
JOIN product pr ON pr.id = s.product_id
WHERE s.quantity <= pr.min_stock
  AND pr.is_inventoried = TRUE
  AND pr.is_active = TRUE;

-- Seriales con garantía vigente
CREATE VIEW v_serials_under_warranty AS
SELECT ps.company_id,
       ps.id AS serial_id,
       pr.sku,
       pr.name AS product_name,
       ps.serial_number,
       ps.customer_id,
       p.legal_name AS customer_name,
       ps.warranty_start_date,
       ps.warranty_end_date,
       (ps.warranty_end_date - CURRENT_DATE) AS days_remaining
FROM product_serial ps
JOIN product pr ON pr.id = ps.product_id
LEFT JOIN partner p ON p.id = ps.customer_id
WHERE ps.status = 'SOLD'
  AND ps.warranty_end_date IS NOT NULL
  AND ps.warranty_end_date >= CURRENT_DATE;

-- Reclamos de garantía abiertos
CREATE VIEW v_open_warranty_claims AS
SELECT wc.company_id,
       wc.claim_number,
       wc.claim_date,
       pr.name AS product_name,
       ps.serial_number,
       p.legal_name AS customer_name,
       wc.status,
       wc.is_under_warranty
FROM warranty_claim wc
JOIN product_serial ps ON ps.id = wc.product_serial_id
JOIN product pr ON pr.id = ps.product_id
LEFT JOIN partner p ON p.id = wc.customer_id
WHERE wc.status IN ('OPEN','IN_REVIEW','APPROVED');

-- Órdenes de servicio (taller) abiertas
CREATE VIEW v_open_service_orders AS
SELECT so.company_id,
       so.order_number,
       so.status,
       p.legal_name AS customer_name,
       COALESCE(pr.name, so.item_description) AS item,
       u.full_name AS technician,
       so.is_warranty,
       so.received_date,
       so.promised_date
FROM service_order so
LEFT JOIN partner p ON p.id = so.customer_id
LEFT JOIN product pr ON pr.id = so.product_id
LEFT JOIN app_user u ON u.id = so.technician_id
WHERE so.status NOT IN ('DELIVERED','CANCELLED');

-- Comprobantes pendientes o rechazados por Hacienda (requieren acción)
CREATE VIEW v_hacienda_pending AS
SELECT i.company_id,
       i.invoice_number,
       i.document_type,
       i.ce_clave,
       i.hacienda_status,
       i.total,
       i.invoice_date
FROM invoice i
WHERE i.hacienda_status IN ('PENDING','SENT','REJECTED');

-- Cotizaciones vigentes (enviadas y aún válidas)
CREATE VIEW v_open_quotations AS
SELECT q.company_id, q.quote_number, q.status, q.total, q.currency_code,
       p.legal_name AS customer_name, q.quote_date, q.valid_until
FROM quotation q
LEFT JOIN partner p ON p.id = q.customer_id
WHERE q.status IN ('DRAFT','SENT')
  AND (q.valid_until IS NULL OR q.valid_until >= CURRENT_DATE);

-- Comprobantes de proveedor recibidos pendientes de importar
CREATE VIEW v_pending_purchase_imports AS
SELECT r.company_id, r.ce_clave, r.document_type, r.total, r.import_status,
       p.legal_name AS supplier_name, r.issue_date
FROM received_document r
LEFT JOIN partner p ON p.id = r.supplier_id
WHERE r.import_status IN ('PENDING','MAPPED');

-- Semáforo de órdenes de servicio según el tiempo del proceso vs. el SLA
--   VERDE: dentro de tiempo · AMARILLO: por vencer (último 25%) · ROJO: vencida · GRIS: cerrada
CREATE VIEW v_service_order_semaphore AS
SELECT so.company_id,
       so.order_number,
       so.status,
       so.priority,
       p.legal_name AS customer_name,
       u.full_name  AS technician,
       so.check_in_at,
       so.due_at,
       CASE
         WHEN so.status IN ('DELIVERED','CANCELLED') THEN 'GRIS'
         WHEN so.due_at IS NULL THEN 'VERDE'
         WHEN now() > so.due_at THEN 'ROJO'
         WHEN now() >= so.due_at - make_interval(mins => GREATEST(15, COALESCE(so.sla_hours,8) * 15))
              THEN 'AMARILLO'
         ELSE 'VERDE'
       END AS semaforo
FROM service_order so
LEFT JOIN partner p ON p.id = so.customer_id
LEFT JOIN app_user u ON u.id = so.technician_id;

-- Agenda de citas próximas del taller
CREATE VIEW v_service_agenda AS
SELECT a.company_id,
       a.scheduled_start,
       a.scheduled_end,
       a.title,
       a.status,
       p.legal_name AS customer_name,
       u.full_name  AS technician,
       a.service_order_id
FROM service_appointment a
LEFT JOIN partner p ON p.id = a.customer_id
LEFT JOIN app_user u ON u.id = a.technician_id
WHERE a.status NOT IN ('DONE','CANCELLED','NO_SHOW');

-- Pedidos del canal web por atender (validar / cobrar)
CREATE VIEW v_web_orders_pending AS
SELECT so.company_id, so.order_number, so.external_ref, so.web_status,
       so.total, so.currency_code, p.legal_name AS customer_name, so.created_at
FROM sales_order so
LEFT JOIN partner p ON p.id = so.customer_id
WHERE so.channel = 'WEB'
  AND COALESCE(so.web_status,'RECEIVED') IN ('RECEIVED','VALIDATED','AWAIT_PAYMENT');

-- Tickets abiertos con su semáforo de SLA (estilo tablero)
CREATE VIEW v_ticket_board AS
SELECT t.company_id,
       t.ticket_number,
       t.ticket_type,
       t.subject,
       t.status,
       t.priority,
       t.stage_id,
       p.legal_name AS company_name,
       u.full_name  AS assigned_to,
       t.due_at,
       CASE
         WHEN t.status IN ('CLOSED','CANCELLED','RESOLVED') THEN 'GRIS'
         WHEN t.due_at IS NULL THEN 'VERDE'
         WHEN now() > t.due_at THEN 'ROJO'
         WHEN now() >= t.due_at - make_interval(mins => GREATEST(15, COALESCE(t.sla_hours,8) * 15)) THEN 'AMARILLO'
         ELSE 'VERDE'
       END AS semaforo
FROM ticket t
LEFT JOIN partner p ON p.id = t.partner_id
LEFT JOIN app_user u ON u.id = t.assigned_to
WHERE t.status NOT IN ('CLOSED','CANCELLED');

-- Mercancía en tránsito (no recibida)
CREATE VIEW v_inventory_in_transit AS
SELECT it.company_id, it.reference, it.origin, it.carrier, it.tracking_number,
       it.status, it.eta_date, w.name AS destination
FROM inventory_transit it
LEFT JOIN warehouse w ON w.id = it.destination_warehouse_id
WHERE it.status NOT IN ('RECEIVED','CANCELLED');

-- Comisiones por vendedor y periodo
CREATE VIEW v_commission_summary AS
SELECT c.company_id, c.period, c.salesperson_id,
       u.full_name AS salesperson, c.status,
       SUM(c.base_amount) AS base_total, SUM(c.amount) AS commission_total
FROM commission c
LEFT JOIN app_user u ON u.id = c.salesperson_id
GROUP BY c.company_id, c.period, c.salesperson_id, u.full_name, c.status;

-- Resumen de cierre de caja por sesión (arqueo y diferencias)
CREATE VIEW v_cash_closing_summary AS
SELECT ps.company_id,
       ps.id AS pos_session_id,
       cr.name AS caja,
       u.full_name AS cajero,
       ps.opened_at, ps.closed_at, ps.status,
       ps.opening_amount, ps.expected_cash, ps.counted_cash, ps.cash_difference
FROM pos_session ps
LEFT JOIN cash_register cr ON cr.id = ps.cash_register_id
LEFT JOIN app_user u ON u.id = ps.user_id;

-- Carritos activos con su total estimado (recuperación de carritos)
CREATE VIEW v_active_carts AS
SELECT c.company_id, c.id AS cart_id, c.web_customer_id, wc.email,
       COUNT(ci.id) AS items,
       COALESCE(SUM(ci.quantity * COALESCE(ci.unit_price_snapshot,0)),0) AS estimated_total,
       c.updated_at
FROM cart c
LEFT JOIN web_customer wc ON wc.id = c.web_customer_id
LEFT JOIN cart_item ci ON ci.cart_id = c.id
WHERE c.status = 'ACTIVE'
GROUP BY c.company_id, c.id, c.web_customer_id, wc.email, c.updated_at;

-- Catálogo publicable en la tienda web (solo productos visibles y activos)
CREATE VIEW v_web_catalog AS
SELECT pr.company_id, pr.id AS product_id, pr.sku, pr.web_slug,
       COALESCE(pr.web_title, pr.name) AS title,
       pr.web_description, pr.sale_price, pr.web_featured,
       (SELECT url FROM product_image pi WHERE pi.product_id = pr.id AND pi.is_primary LIMIT 1) AS image_url
FROM product pr
WHERE pr.web_published = TRUE AND pr.is_active = TRUE;

-- Cotizaciones con su margen de utilidad
CREATE VIEW v_quotation_margin AS
SELECT q.company_id, q.quote_number, q.status, q.sales_stage,
       p.legal_name AS customer_name,
       q.cost_total, q.total, q.margin_amount, q.margin_pct, q.currency_code, q.quote_date
FROM quotation q
LEFT JOIN partner p ON p.id = q.customer_id;

-- Productos fuera del rango de máximos/mínimos
CREATE VIEW v_stock_minmax_alert AS
SELECT s.product_id, pr.sku, pr.name, s.warehouse_id, s.quantity,
       pr.min_stock, pr.max_stock,
       CASE WHEN s.quantity <= pr.min_stock THEN 'BAJO_MINIMO'
            WHEN pr.max_stock > 0 AND s.quantity >= pr.max_stock THEN 'SOBRE_MAXIMO'
            ELSE 'OK' END AS estado
FROM stock s
JOIN product pr ON pr.id = s.product_id
WHERE pr.is_inventoried = TRUE AND pr.is_active = TRUE
  AND (s.quantity <= pr.min_stock OR (pr.max_stock > 0 AND s.quantity >= pr.max_stock));

-- Ajustes de inventario pendientes de confirmar
CREATE VIEW v_pending_inventory_adjustments AS
SELECT a.company_id, a.adjustment_number, a.adjustment_date, a.reason, a.status,
       w.name AS warehouse, u.full_name AS created_by
FROM inventory_adjustment a
LEFT JOIN warehouse w ON w.id = a.warehouse_id
LEFT JOIN app_user u ON u.id = a.created_by
WHERE a.status = 'DRAFT';

-- ============================================================================
-- 21. PRECIOS — núcleo (PR-32, HU-11.1)
-- ============================================================================
-- Modelo costo/margen/precio a nivel producto. El margen es **sobre el precio
-- de venta** (no sobre costo): margin_pct = (price - cost) / price.
-- En este PR el costo es editable manualmente; en PR-33 se derivará del
-- kardex (costo promedio ponderado) y la edición manual se volverá un ajuste
-- auditado. Las columnas margin_pct/min_margin_pct viven aquí en producto;
-- la extensión per-lista (price_list_item.margin_pct/out_of_margin) queda
-- congelada en docs/requisitos-precios-cxc.md §1–2 para un PR posterior.
ALTER TABLE product
    ADD COLUMN margin_pct      NUMERIC(7,4) NOT NULL DEFAULT 0,        -- intención del usuario, 0.30 = 30 %
    ADD COLUMN min_margin_pct  NUMERIC(7,4) NOT NULL DEFAULT 0,        -- piso aceptable para flag out_of_margin
    ADD COLUMN out_of_margin   BOOLEAN      NOT NULL DEFAULT FALSE;    -- snapshot = (margin_pct < min_margin_pct)

ALTER TABLE product
    ADD CONSTRAINT chk_product_margin_pct
        CHECK (margin_pct >= 0 AND margin_pct < 1),
    ADD CONSTRAINT chk_product_min_margin_pct
        CHECK (min_margin_pct >= 0 AND min_margin_pct < 1);

-- Extensión de product_price_history para capturar el trío costo/margen/precio
-- en una sola fila + un motivo libre del usuario. Los campos legacy
-- (old_value/new_value, change_type) se mantienen para compatibilidad con la
-- semántica histórica (COST/SALE/etc.) que vendrá en sprints futuros.
ALTER TABLE product_price_history
    ADD COLUMN cost_value  NUMERIC(18,4),
    ADD COLUMN margin_pct  NUMERIC(7,4),
    ADD COLUMN reason      TEXT;

-- ============================================================================
-- 22. PRECIOS — 3 niveles fijos (PR-34, HU-11.2)
-- ============================================================================
-- Pasamos de precio único a 3 niveles fijos por producto, reusando el modelo
-- canónico `price_list` / `price_list_item`. Por empresa se seedean 3 listas:
-- "Precio 1", "Precio 2", "Precio 3" (tipo SALE). Por producto se tiene una
-- fila en `price_list_item` por cada nivel con su propio (margin_pct, price).
--
-- COSTO sigue compartido: `product.cost_price` no se repite por nivel.
-- min_margin_pct sigue siendo uno por producto: `product.min_margin_pct`.
-- out_of_margin de `product` ahora es agregado: true si CUALQUIER nivel
-- queda con margen < min. `price_list_item.out_of_margin` guarda el flag
-- por fila (preparado para el utilitario operativo de req §5).
--
-- product.sale_price y product.margin_pct se conservan como denormalización
-- del nivel "Precio 1" (lista por defecto) para no romper la columna del
-- listado de productos ni la vista v_web_catalog. Se sincronizan al guardar.
ALTER TABLE price_list_item
    ADD COLUMN margin_pct    NUMERIC(7,4) NOT NULL DEFAULT 0,
    ADD COLUMN out_of_margin BOOLEAN      NOT NULL DEFAULT FALSE;

ALTER TABLE price_list_item
    ADD CONSTRAINT chk_pli_margin_pct
        CHECK (margin_pct >= 0 AND margin_pct < 1);

-- El historial gana referencia al nivel afectado. NULL = cambio que no
-- pertenece a un nivel (p. ej., cambio de costo o de min_margin_pct).
ALTER TABLE product_price_history
    ADD COLUMN price_list_id BIGINT REFERENCES price_list(id);
CREATE INDEX idx_pricehist_pricelist ON product_price_history(price_list_id);

-- ============================================================================
-- 23. PRECIOS — nivel aplicado por línea (PR-37, HU-11.3)
-- ============================================================================
-- Cada línea de cotización (y eventualmente OV/factura) puede registrar el
-- nivel de precio elegido al cotizar. Esto deja auditoría de "qué lista se
-- aplicó" y permite reportes/operaciones sobre líneas vendidas a Precio 2,
-- por ejemplo. El precio efectivo de la línea (`unit_price`) sigue siendo
-- editable por el vendedor — `price_list_id` es informativo y opcional
-- (NULL = línea sin nivel asociado / precio libre).
ALTER TABLE quotation_line
    ADD COLUMN price_list_id BIGINT REFERENCES price_list(id);
CREATE INDEX idx_quoteline_pricelist ON quotation_line(price_list_id);

-- ============================================================================
-- 24. PRECIOS — nivel propagado en OV y Factura (PR-38, HU-11.4)
-- ============================================================================
-- Mismo campo que en quotation_line: nullable, informativo/auditoría. El
-- precio acordado (`unit_price`) NO se recalcula al convertir cotización→OV
-- ni OV→Factura; el nivel viaja solo como referencia/trazabilidad.
ALTER TABLE sales_order_line
    ADD COLUMN price_list_id BIGINT REFERENCES price_list(id);
CREATE INDEX idx_soline_pricelist ON sales_order_line(price_list_id);

ALTER TABLE invoice_line
    ADD COLUMN price_list_id BIGINT REFERENCES price_list(id);
CREATE INDEX idx_invline_pricelist ON invoice_line(price_list_id);

-- ============================================================================
-- 25. SECUENCIAS DE DOCUMENTOS (PR-39, HU-12.1)
-- ============================================================================
-- Una fila por (empresa, tipo) con el "próximo valor" a asignar. La
-- generación atómica vive en el service como `UPDATE ... SET next_value =
-- next_value + 1 ... RETURNING next_value`, garantizando que dos
-- transacciones concurrentes nunca obtengan el mismo número.
--
-- Por ahora solo se usa para PRODUCT_SKU (autoincremento por empresa,
-- arranca en 100000). El diseño es genérico: futuros tipos como
-- INVOICE_NUMBER, QUOTE_NUMBER, SO_NUMBER pueden compartir la misma tabla.
CREATE TABLE document_sequence (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES company(id),
    sequence_type   VARCHAR(30) NOT NULL,                  -- p.ej. PRODUCT_SKU
    next_value      BIGINT NOT NULL,                       -- próximo valor a entregar
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, sequence_type)
);

-- ============================================================================
-- FIN DEL ESQUEMA
-- ============================================================================
