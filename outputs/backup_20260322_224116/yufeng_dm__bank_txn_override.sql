--
-- PostgreSQL database dump
--

\restrict fasgdkbo0700Db2y7NUvUciCZk72uAU4AXNtOTOgpaae1MCE004xotHBTS9qbYq

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

DROP INDEX IF EXISTS yufeng_dm.idx_override_lvl1;
DROP INDEX IF EXISTS yufeng_dm.idx_override_bank_txn_id;
ALTER TABLE IF EXISTS ONLY yufeng_dm.bank_txn_override DROP CONSTRAINT IF EXISTS bank_txn_override_pkey;
ALTER TABLE IF EXISTS ONLY yufeng_dm.bank_txn_override DROP CONSTRAINT IF EXISTS bank_txn_override_bank_txn_id_key;
ALTER TABLE IF EXISTS yufeng_dm.bank_txn_override ALTER COLUMN id DROP DEFAULT;
DROP SEQUENCE IF EXISTS yufeng_dm.bank_txn_override_id_seq;
DROP TABLE IF EXISTS yufeng_dm.bank_txn_override;
SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: bank_txn_override; Type: TABLE; Schema: yufeng_dm; Owner: -
--

CREATE TABLE yufeng_dm.bank_txn_override (
    id bigint NOT NULL,
    bank_txn_id bigint NOT NULL,
    lvl1 text NOT NULL,
    lvl2 text,
    note text,
    created_by text DEFAULT 'ui'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bank_txn_override_id_seq; Type: SEQUENCE; Schema: yufeng_dm; Owner: -
--

CREATE SEQUENCE yufeng_dm.bank_txn_override_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bank_txn_override_id_seq; Type: SEQUENCE OWNED BY; Schema: yufeng_dm; Owner: -
--

ALTER SEQUENCE yufeng_dm.bank_txn_override_id_seq OWNED BY yufeng_dm.bank_txn_override.id;


--
-- Name: bank_txn_override id; Type: DEFAULT; Schema: yufeng_dm; Owner: -
--

ALTER TABLE ONLY yufeng_dm.bank_txn_override ALTER COLUMN id SET DEFAULT nextval('yufeng_dm.bank_txn_override_id_seq'::regclass);


--
-- Data for Name: bank_txn_override; Type: TABLE DATA; Schema: yufeng_dm; Owner: -
--

COPY yufeng_dm.bank_txn_override (id, bank_txn_id, lvl1, lvl2, note, created_by, created_at, updated_at) FROM stdin;
1	1892	材料采购	包装	人工匹配	ui	2026-03-22 10:18:49.554554+00	2026-03-22 10:18:49.554554+00
2	1902	管理费用	\N	人工匹配	ui	2026-03-22 10:19:11.201916+00	2026-03-22 10:19:11.201916+00
3	1903	材料采购	耗材	人工匹配	ui	2026-03-22 10:19:20.753595+00	2026-03-22 10:19:20.753595+00
4	1904	销售费用	\N	人工匹配	ui	2026-03-22 10:19:27.704709+00	2026-03-22 10:19:27.704709+00
5	1912	管理费用	\N	人工匹配	ui	2026-03-22 10:20:23.77141+00	2026-03-22 10:20:23.77141+00
6	1911	销售费用	\N	人工匹配	ui	2026-03-22 10:20:33.004738+00	2026-03-22 10:20:33.004738+00
7	1949	营业收入	其他	人工匹配	ui	2026-03-22 10:20:46.592805+00	2026-03-22 10:20:46.592805+00
8	1960	人力成本	工资	人工匹配	ui	2026-03-22 10:20:55.910976+00	2026-03-22 10:20:55.910976+00
9	2007	材料采购	食材	人工匹配	ui	2026-03-22 10:21:23.300535+00	2026-03-22 10:21:23.300535+00
10	2008	管理费用	\N	人工匹配	ui	2026-03-22 10:21:26.977787+00	2026-03-22 10:21:26.977787+00
11	2014	管理费用	\N	人工匹配	ui	2026-03-22 10:58:19.087389+00	2026-03-22 10:58:19.087389+00
12	1961	财务费用	\N	人工匹配	ui	2026-03-22 14:17:43.324643+00	2026-03-22 14:17:43.324643+00
13	1962	其他收入	借款	人工匹配	ui	2026-03-22 14:27:08.008958+00	2026-03-22 14:27:08.008958+00
14	2016	营建费用	\N	人工匹配	ui	2026-03-22 14:32:43.441075+00	2026-03-22 14:32:43.441075+00
15	2030	营业收入	其他	人工匹配	ui	2026-03-22 14:32:57.667109+00	2026-03-22 14:32:57.667109+00
16	2031	财务费用	其他	人工匹配	ui	2026-03-22 14:33:20.957925+00	2026-03-22 14:33:20.957925+00
17	2044	管理费用	准备金	人工匹配	ui	2026-03-22 14:33:33.850251+00	2026-03-22 14:33:33.850251+00
18	2045	物料采购	食材	人工匹配	ui	2026-03-22 14:33:41.023342+00	2026-03-22 14:33:41.023342+00
19	2074	营建费用	\N	人工匹配	ui	2026-03-22 14:33:46.004079+00	2026-03-22 14:33:46.004079+00
20	2084	财务费用	其他	人工匹配	ui	2026-03-22 14:33:51.66137+00	2026-03-22 14:33:51.66137+00
21	2095	其他收入	利息	人工匹配	ui	2026-03-22 14:33:58.645458+00	2026-03-22 14:33:58.645458+00
22	2103	管理费用	报销	人工匹配	ui	2026-03-22 14:34:02.982534+00	2026-03-22 14:34:02.982534+00
23	2105	财务费用	其他	人工匹配	ui	2026-03-22 14:34:14.326791+00	2026-03-22 14:34:14.326791+00
24	2118	人力成本	工资	人工匹配	ui	2026-03-22 14:34:20.053117+00	2026-03-22 14:34:20.053117+00
25	2128	管理费用	报销	人工匹配	ui	2026-03-22 14:34:34.522413+00	2026-03-22 14:34:34.522413+00
26	2137	管理费用	报销	人工匹配	ui	2026-03-22 14:34:39.443079+00	2026-03-22 14:34:39.443079+00
27	2138	管理费用	报销	人工匹配	ui	2026-03-22 14:34:42.977987+00	2026-03-22 14:34:42.977987+00
28	2139	管理费用	报销	人工匹配	ui	2026-03-22 14:34:46.88597+00	2026-03-22 14:34:46.88597+00
29	2141	管理费用	报销	人工匹配	ui	2026-03-22 14:34:52.216109+00	2026-03-22 14:34:52.216109+00
30	2144	财务费用	其他	人工匹配	ui	2026-03-22 14:34:57.325285+00	2026-03-22 14:34:57.325285+00
31	2146	物料采购	食材	人工匹配	ui	2026-03-22 14:35:03.963748+00	2026-03-22 14:35:03.963748+00
32	2156	租金	物业	人工匹配	ui	2026-03-22 14:35:22.105044+00	2026-03-22 14:35:22.105044+00
33	2159	财务费用	其他	人工匹配	ui	2026-03-22 14:35:31.764717+00	2026-03-22 14:35:31.764717+00
34	2163	营建费用	\N	人工匹配	ui	2026-03-22 14:35:36.365358+00	2026-03-22 14:35:36.365358+00
35	2176	营建费用	\N	人工匹配	ui	2026-03-22 14:35:44.609458+00	2026-03-22 14:35:44.609458+00
36	2175	营建费用	\N	人工匹配	ui	2026-03-22 14:35:48.121684+00	2026-03-22 14:35:48.121684+00
37	2172	管理费用	报销	人工匹配	ui	2026-03-22 14:35:52.462197+00	2026-03-22 14:35:52.462197+00
\.


--
-- Name: bank_txn_override_id_seq; Type: SEQUENCE SET; Schema: yufeng_dm; Owner: -
--

SELECT pg_catalog.setval('yufeng_dm.bank_txn_override_id_seq', 37, true);


--
-- Name: bank_txn_override bank_txn_override_bank_txn_id_key; Type: CONSTRAINT; Schema: yufeng_dm; Owner: -
--

ALTER TABLE ONLY yufeng_dm.bank_txn_override
    ADD CONSTRAINT bank_txn_override_bank_txn_id_key UNIQUE (bank_txn_id);


--
-- Name: bank_txn_override bank_txn_override_pkey; Type: CONSTRAINT; Schema: yufeng_dm; Owner: -
--

ALTER TABLE ONLY yufeng_dm.bank_txn_override
    ADD CONSTRAINT bank_txn_override_pkey PRIMARY KEY (id);


--
-- Name: idx_override_bank_txn_id; Type: INDEX; Schema: yufeng_dm; Owner: -
--

CREATE INDEX idx_override_bank_txn_id ON yufeng_dm.bank_txn_override USING btree (bank_txn_id);


--
-- Name: idx_override_lvl1; Type: INDEX; Schema: yufeng_dm; Owner: -
--

CREATE INDEX idx_override_lvl1 ON yufeng_dm.bank_txn_override USING btree (lvl1);


--
-- PostgreSQL database dump complete
--

\unrestrict fasgdkbo0700Db2y7NUvUciCZk72uAU4AXNtOTOgpaae1MCE004xotHBTS9qbYq

