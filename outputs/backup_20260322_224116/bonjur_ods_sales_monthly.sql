--
-- PostgreSQL database dump
--

\restrict oAfi3luSixetjasvQrjvlHGuQqji2SJBv1p017eDMMHrKS43sPvuUcLSzLwbX3k

-- Dumped from database version 16.13 (Debian 16.13-1.pgdg13+1)
-- Dumped by pg_dump version 16.13 (Debian 16.13-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

DROP INDEX IF EXISTS bonjur_ods.idx_sales_monthly_store;
DROP INDEX IF EXISTS bonjur_ods.idx_sales_monthly_month;
ALTER TABLE IF EXISTS ONLY bonjur_ods.sales_monthly DROP CONSTRAINT IF EXISTS uq_sales_monthly;
ALTER TABLE IF EXISTS ONLY bonjur_ods.sales_monthly DROP CONSTRAINT IF EXISTS sales_monthly_pkey;
ALTER TABLE IF EXISTS bonjur_ods.sales_monthly ALTER COLUMN id DROP DEFAULT;
DROP SEQUENCE IF EXISTS bonjur_ods.sales_monthly_id_seq;
DROP TABLE IF EXISTS bonjur_ods.sales_monthly;
SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: sales_monthly; Type: TABLE; Schema: bonjur_ods; Owner: -
--

CREATE TABLE bonjur_ods.sales_monthly (
    id bigint NOT NULL,
    store_code text NOT NULL,
    store_name text,
    month date NOT NULL,
    gross_sales_amt numeric(14,2),
    discount_amt numeric(14,2),
    revenue_amt numeric(14,2),
    order_cnt integer,
    refund_amt numeric(14,2),
    source_file_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sales_monthly_id_seq; Type: SEQUENCE; Schema: bonjur_ods; Owner: -
--

CREATE SEQUENCE bonjur_ods.sales_monthly_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sales_monthly_id_seq; Type: SEQUENCE OWNED BY; Schema: bonjur_ods; Owner: -
--

ALTER SEQUENCE bonjur_ods.sales_monthly_id_seq OWNED BY bonjur_ods.sales_monthly.id;


--
-- Name: sales_monthly id; Type: DEFAULT; Schema: bonjur_ods; Owner: -
--

ALTER TABLE ONLY bonjur_ods.sales_monthly ALTER COLUMN id SET DEFAULT nextval('bonjur_ods.sales_monthly_id_seq'::regclass);


--
-- Data for Name: sales_monthly; Type: TABLE DATA; Schema: bonjur_ods; Owner: -
--

COPY bonjur_ods.sales_monthly (id, store_code, store_name, month, gross_sales_amt, discount_amt, revenue_amt, order_cnt, refund_amt, source_file_id, created_at) FROM stdin;
11	wz_oh_wxc	温州瓯海万象城店	2026-02-01	175193.43	46136.49	129056.94	4139	1719.23	2	2026-03-22 07:58:08.195574+00
12	wz_ra_wy	温州瑞安吾悦广场店	2026-02-01	167765.17	47572.55	120192.62	4196	1846.52	2	2026-03-22 07:58:08.195574+00
\.


--
-- Name: sales_monthly_id_seq; Type: SEQUENCE SET; Schema: bonjur_ods; Owner: -
--

SELECT pg_catalog.setval('bonjur_ods.sales_monthly_id_seq', 12, true);


--
-- Name: sales_monthly sales_monthly_pkey; Type: CONSTRAINT; Schema: bonjur_ods; Owner: -
--

ALTER TABLE ONLY bonjur_ods.sales_monthly
    ADD CONSTRAINT sales_monthly_pkey PRIMARY KEY (id);


--
-- Name: sales_monthly uq_sales_monthly; Type: CONSTRAINT; Schema: bonjur_ods; Owner: -
--

ALTER TABLE ONLY bonjur_ods.sales_monthly
    ADD CONSTRAINT uq_sales_monthly UNIQUE (store_code, month);


--
-- Name: idx_sales_monthly_month; Type: INDEX; Schema: bonjur_ods; Owner: -
--

CREATE INDEX idx_sales_monthly_month ON bonjur_ods.sales_monthly USING btree (month);


--
-- Name: idx_sales_monthly_store; Type: INDEX; Schema: bonjur_ods; Owner: -
--

CREATE INDEX idx_sales_monthly_store ON bonjur_ods.sales_monthly USING btree (store_code);


--
-- PostgreSQL database dump complete
--

\unrestrict oAfi3luSixetjasvQrjvlHGuQqji2SJBv1p017eDMMHrKS43sPvuUcLSzLwbX3k

