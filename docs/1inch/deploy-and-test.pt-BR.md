# Noria: deploy com Rabby e testes, do zero

Este guia em português foi solicitado pelo responsável pelo projeto. O código, os demais documentos e os textos do produto continuam em inglês.

**Carteira do deploy: `0xc365B6795443380eb76516dA0Cedd5a00B349d66`. Rede: Arbitrum One, chain ID `42161`.** Você assina na extensão Rabby. Não precisa exportar chave privada, importar seed no terminal, usar hardware wallet ou configurar um signer na Vercel.

São dois deploys: primeiro `UniswapInventoryAdapter`, depois `PositionFactory`. A página local prepara os dados, simula, apresenta a estimativa de gas e verifica os recibos. Ela só abre a solicitação da Rabby depois de você clicar em **Confirm deployment in Rabby**. Conectar a carteira e preparar uma revisão não envia transações.

## 1. O que você precisa ter

| Item                                               | Para que serve                            | É necessário pagar?                                             |
| -------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------- |
| Mac e aplicativo Terminal                          | Executar os comandos abaixo               | Não                                                             |
| Chrome ou Brave com Rabby instalada e desbloqueada | Confirmar as duas transações              | A extensão não cobra pelo deploy; a rede cobra gas              |
| A carteira indicada acima selecionada na Rabby     | Ser a remetente dos deploys               | Precisa de ETH **na Arbitrum One**                              |
| Node.js 22 e npm                                   | Executar o projeto e a página local       | Não                                                             |
| Git                                                | Baixar o código                           | Não                                                             |
| Foundry: `forge`, `cast`, `anvil`                  | Compilar, conferir os contratos e simular | Não                                                             |
| Conexão com RPC da Arbitrum                        | Ler e simular o estado da rede            | O padrão público pode funcionar; limites e falhas são possíveis |
| Acesso à Vercel e ao app Privy existente           | Configurar o frontend após o deploy       | Não mudar o plano Privy; manter o gratuito                      |

**Não envie USDC para pagar gas.** Na Arbitrum, as taxas são pagas em ETH. ETH na Ethereum ou em outra rede não é o saldo utilizado aqui. A página local mostra o saldo e uma estimativa em ETH com equivalente em USD quando existe cotação válida. Não há um valor fixo de gas garantido: veja as duas estimativas, uma por etapa, e a confirmação final da Rabby.

A fábrica não recebe os fundos dos usuários e não tem administrador. A carteira de deploy não se torna dona das posições criadas por outras pessoas. Cada usuário cria sua própria `PositionAccount`, com seu próprio colateral e sua própria dívida.

## 2. Abrir o Terminal e conferir os programas

No Mac, pressione **Command + Espaço**, digite **Terminal** e pressione Enter. Copie um bloco de cada vez e espere aparecer novamente a linha onde você pode digitar. Não copie o símbolo de prompt de exemplos da internet.

```sh
node --version
npm --version
git --version
```

O primeiro comando deve mostrar `v22...`. Se Node não existir ou estiver em outra versão principal, instale Node **22.x** pelo [site oficial](https://nodejs.org/en/download), feche e reabra o Terminal. Se o Mac solicitar as ferramentas de linha de comando ao executar Git, conclua a instalação oferecida pelo próprio macOS.

Para instalar Foundry, use o instalador oficial. Este comando baixa e executa o instalador; confira que o domínio é exatamente o mostrado:

```sh
curl -L https://foundry.paradigm.xyz | bash
```

Depois execute:

```sh
export PATH="$HOME/.foundry/bin:$PATH"
foundryup --install v1.0.0
forge --version
cast --version
anvil --version
```

A versão `v1.0.0` é a utilizada na validação deste repositório. O compilador Solidity **0.8.30**, EVM **Cancun**, otimização ligada e **200 runs** estão fixados em `integrations/aqua/contracts/foundry.toml`. Forge obtém o compilador na primeira compilação. Não altere essas opções: isso altera o bytecode que o frontend aceita.

Se outro Terminal não encontrar `forge`, repita apenas o comando `export PATH=...` nessa janela. Ele não contém segredo.

## 3. Baixar uma cópia limpa

Para uma instalação nova:

```sh
mkdir -p "$HOME/Documents/Noria"
cd "$HOME/Documents/Noria"
git clone https://github.com/rafaelzochling/noria.git
cd noria
npm ci
```

Se a pasta já existe, não apague nem sobrescreva arquivos. Entre na cópia existente e confira o estado:

```sh
cd "$HOME/Documents/Noria/noria"
git status --short
git branch --show-current
```

Se não houver alterações locais e você estiver em `main`, atualize com:

```sh
git pull --ff-only
npm ci
```

Se houver alterações, preserve-as e utilize outra pasta limpa. Todos os comandos deste guia, exceto os de instalação, são executados **na raiz de `noria`**, onde está `package.json`. Não misture `npm ci` na raiz com uma instalação pnpm dentro do módulo nessa mesma cópia.

## 4. Conferir o código antes de gastar gas

```sh
npm run typecheck
npm test
npm run --workspace @noria/aqua check
forge test --root integrations/aqua/contracts
npm run aqua:artifacts
```

O último comando recompila e compara os artefatos com os aceitos pelo frontend. Deve terminar em `PASS`. Se disser `Stale public artifact`, pare antes de assinar: o código compilado difere do publicado. `npm run aqua:artifacts -- --write` existe para quem está alterando o código, mas exige revisão do diff, testes e novo build do app; não é um botão para ignorar incompatibilidade.

O runtime da fábrica revisada tem **22.889 bytes**, abaixo do limite de **24.576**. Essa verificação é automática. Os testes unitários usam mocks; o próximo passo valida os contratos oficiais no fork.

## 5. Simular os dois deploys, sem gastar dinheiro real

```sh
npm run validate:aqua-deployment
```

Este comando inicia seu próprio Anvil em `127.0.0.1`, copia um bloco da Arbitrum e usa o endereço da sua Rabby por impersonação **somente nesse fork**. O saldo de teste é artificial. Ele prepara, publica e verifica o adaptador e a fábrica com a mesma implementação utilizada pelo assistente de deploy. O RPC público é utilizado para leitura; as transações vão somente para o Anvil criado pelo processo.

Resultado esperado: dois recibos com `PASS` e um relatório em:

```text
.runtime/aqua-deployment-rehearsal.json
```

Isso **não** publica os contratos na Arbitrum, não pede assinatura Rabby e não comprova uma integração Privy real. Não procure esses hashes do fork no Arbiscan.

Para ler o relatório formatado:

```sh
python3 -m json.tool .runtime/aqua-deployment-rehearsal.json
```

## 6. Iniciar a página local de deploy

```sh
npm run deploy:aqua
```

O terminal mostra:

```text
NORIA / CONTRACT DEPLOYMENT
PASS  Solidity artifacts match the frontend runtime identities.
READY http://127.0.0.1:3210
```

**Deixe esse terminal aberto.** No Chrome ou Brave onde a Rabby está instalada, abra [http://127.0.0.1:3210](http://127.0.0.1:3210). Não abra no navegador interno de um aplicativo que não tenha a extensão.

A porta `3210` pertence apenas ao assistente local de deploy. O app Noria de desenvolvimento usa a porta `3100`. O assistente não é publicado na Vercel. Ele só escuta no loopback, recusa outras origens e não tem chave, função de assinatura ou método de broadcast no servidor.

Se aparecer “port 3210 may already be in use”, procure a janela de terminal onde esse mesmo comando já está rodando. Use a página existente ou pressione **Control + C** naquela janela antes de iniciar novamente. Não encerre processos desconhecidos.

## 7. Conectar a Rabby

1. Desbloqueie a Rabby e selecione `0xc365B6795443380eb76516dA0Cedd5a00B349d66`.
2. Na página local, clique **Connect Rabby**.
3. Na extensão, confirme a conexão desse site local à carteira correta.
4. Autorize a seleção de **Arbitrum One** quando solicitada. O assistente verifica `42161` antes de assinar.
5. Confira que a página mostra a mesma carteira e seu saldo ETH na Arbitrum.

Conexão não é deploy e não cobra gas. Não cole seed phrase ou chave privada em nenhum campo. Este fluxo não utiliza `cast wallet import`, `--private-key`, `eth_sign` nem assinaturas de mensagens cegas.

## 8. Publicar o adaptador

1. Clique **Prepare deployment**.
2. Espere a leitura dos protocolos, a simulação e a estimativa. O relógio mostra tempo decorrido, sem porcentagem artificial.
3. Confira **Contract: adapter**, **Network: Arbitrum One**, a carteira, o endereço esperado, nonce e taxa estimada.
4. Expanda **Constructor parameters and exact unsigned data**. Os parâmetros devem ser:

| Parâmetro | Valor                                         |
| --------- | --------------------------------------------- |
| `router_` | `0xe592427a0aece92de3edee1f18e0157c05861564`  |
| `weth_`   | `0x82af49447d8a07e3bd95bd0d56f35241523fbab1`  |
| `usdc_`   | `0xaf88d065e77c8cc2239327c5edb3a432268e5831`  |
| `fee_`    | `500` — rota de conversão Uniswap V3 de 0,05% |

5. Clique **Confirm deployment in Rabby**.
6. Na Rabby, confira remetente, rede, gas e **criação de contrato**. A criação pode aparecer sem nome verificado porque o endereço ainda não existe. O valor nativo enviado ao contrato é zero; a despesa é o gas. Não deve haver aprovação de USDC nem transferência de colateral.
7. Se os dados corresponderem à revisão, confirme na própria Rabby. **Este é o momento em que você autoriza gastar gas real.** Você pode rejeitar antes de confirmar.
8. Aguarde a confirmação em **Activity** da Rabby. A página salva o hash retornado.
9. Clique **Verify saved deployment**. A verificação confere remetente, nonce, calldata completa, valor zero, chain ID, recibo canônico, endereço criado e runtime.
10. A primeira etapa deve mudar para **Verified**. Só então a fábrica é liberada.

O endereço esperado deriva da carteira e do nonce. **Não use essa carteira para outra transação enquanto assina estes passos.** Se o nonce mudar antes do envio, cancele a revisão ainda não assinada e prepare outra. Se algo já estiver pendente, recupere o hash em vez de repetir.

## 9. Publicar a fábrica

Na mesma página, clique novamente **Prepare deployment**. Agora o contrato é `factory`. O único argumento é a estrutura `Protocols`, nesta ordem:

| Campo      | Endereço                                                                     |
| ---------- | ---------------------------------------------------------------------------- |
| `weth`     | `0x82af49447d8a07e3bd95bd0d56f35241523fbab1`                                 |
| `usdc`     | `0xaf88d065e77c8cc2239327c5edb3a432268e5831`                                 |
| `aWeth`    | `0xe50fa9b3c56ffb159cb0fca61f5c9d750e8128c8`                                 |
| `aUsdc`    | `0x724dc807b04555b71ed48a6896b6f41593b8c637`                                 |
| `debtUSDC` | `0xf611aeb5013fd2c0511c9cd55c7dc5c1140741a6`                                 |
| `aave`     | `0x794a61358d6845594f94dc1db02a252b5b4814ad`                                 |
| `aqua`     | `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a`                                 |
| `swapVM`   | `0x111111338c5091e8440b67b168bae16a668ac0de`                                 |
| `adapter`  | Endereço **real e verificado** do passo anterior, preenchido automaticamente |

Repita revisão → **Confirm deployment in Rabby** → confirmação na extensão → **Verify saved deployment**. A verificação final também chama a mesma camada de identidade usada pela API de launch do Noria.

**Não é necessário publicar `PositionAccount` manualmente.** A fábrica cria uma conta por posição quando o usuário inicia o fluxo do app. Não publique cópias próprias de Aqua, SwapVM ou Aave.

## 10. Guardar os comprovantes e verificar o código no explorer

Clique **Download deployment report**. O servidor também preserva, dentro da sua cópia local:

```text
.runtime/aqua-deployment/deployment.json
.runtime/aqua-deployment/adapter-unsigned.json
.runtime/aqua-deployment/factory-unsigned.json
.runtime/aqua-deployment/adapter-constructor-args.txt
.runtime/aqua-deployment/factory-constructor-args.txt
.runtime/aqua-deployment/adapter-standard-input.json
.runtime/aqua-deployment/factory-standard-input.json
```

O relatório contém revisões, nonce, estimativas, endereços, transações, recibos, gas efetivo, runtime hash, bloco e momento da verificação. Cancelamentos e reconhecimentos manuais ficam identificados; recibos revertidos não viram deploys aprovados. Esses arquivos não contêm chave privada. `.runtime` não é enviado ao Git por padrão.

Abra os links Arbiscan da página para confirmar os recibos públicos. **Verificação de runtime pelo Noria e publicação do código no explorer são coisas diferentes.** Para publicar o fonte sem colocar uma chave de API no terminal:

1. Abra a página do endereço do adaptador em [Arbiscan](https://arbiscan.io).
2. Vá a **Contract → Verify and Publish**.
3. Selecione **Solidity (Standard-Json-Input)**, compilador **v0.8.30+commit.73712a01**, licença **MIT**.
4. Envie `adapter-standard-input.json`. O JSON inclui as configurações de compilação. Se o explorer pedir argumentos ABI do construtor, gere com o comando abaixo.
5. Repita no endereço da fábrica com `factory-standard-input.json`.

Caso algum `standard-input.json` não tenha sido gerado automaticamente, substitua o endereço indicado e execute:

```sh
forge verify-contract ENDERECO_REAL_DO_ADAPTADOR \
  src/UniswapInventoryAdapter.sol:UniswapInventoryAdapter \
  --root integrations/aqua/contracts --show-standard-json-input \
  > .runtime/aqua-deployment/adapter-standard-input.json

forge verify-contract ENDERECO_REAL_DA_FABRICA \
  src/PositionFactory.sol:PositionFactory \
  --root integrations/aqua/contracts --show-standard-json-input \
  > .runtime/aqua-deployment/factory-standard-input.json
```

`ENDERECO_REAL_...` é um marcador, não deve ser copiado literalmente. Use os endereços do relatório. Os comandos apenas geram fonte para verificação, sem assinar nem enviar transações.

Argumentos ABI do adaptador:

```sh
cast abi-encode 'constructor(address,address,address,uint24)' \
  0xe592427a0aece92de3edee1f18e0157c05861564 \
  0x82af49447d8a07e3bd95bd0d56f35241523fbab1 \
  0xaf88d065e77c8cc2239327c5edb3a432268e5831 500
```

Para a fábrica, o arquivo já contém a tupla na ordem correta:

```sh
cast abi-encode 'constructor((address,address,address,address,address,address,address,address,address))' \
  "$(cat .runtime/aqua-deployment/factory-constructor-args.txt)"
```

Se o explorer solicitar hexadecimal sem prefixo, remova apenas o `0x` inicial. Não altere endereços, compilador ou otimização para “fazer a verificação passar”.

## 11. Configurar a Vercel e a Privy

Na página local concluída, copie a linha `NORIA_AQUA_FACTORY_ADDRESS=0x...`. Abra o projeto Noria na Vercel, **Settings → Environment Variables**:

O código principal, os PRs e os merges continuam em `rafaelzochling/noria`. O projeto existente `dev0xmvercosa/noria` na Vercel está conectado ao fork `0xmvercosa/noria`, branch `main`, e mantém o endereço `https://noria-blue.vercel.app`. O fork serve para publicação; não faça alterações independentes nele. O deploy dos contratos continua sendo feito pela Rabby indicada neste guia; não depende da hospedagem do site.

A Vercel exige que quem conecta um repositório de uma conta pessoal seja seu **proprietário**. Ser colaborador com escrita não basta, segundo a [documentação oficial](https://vercel.com/docs/git/vercel-for-github#personal-account-repositories). O fork permite usar a integração da sua conta sem transferir o repositório do Rafael de volta.

Depois de cada merge aprovado no repositório do Rafael, atualize o fork para publicar as alterações:

```sh
gh repo sync 0xmvercosa/noria --source rafaelzochling/noria --branch main
```

Essa sincronização é manual: o fork não acompanha a origem automaticamente. Não use `--force`. Confira que a Vercel terminou o deployment de **Production** com estado **Ready** e o mesmo commit da origem. Veja [publicação pelo fork](../deployment.md#repository-and-deployment-fork) para conferir os hashes e resolver divergências.

| Nome                         | Valor / orientação                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| `NORIA_AQUA_FACTORY_ADDRESS` | Apenas o endereço real da fábrica, sem aspas e sem prefixo `NORIA_...=` dentro do campo de valor |
| `NEXT_PUBLIC_PRIVY_APP_ID`   | `cmtz6hgk203un0cid7ir0e9w2`                                                                      |
| `NORIA_ENABLE_LOCAL_FORK`    | `0`                                                                                              |
| `ARBITRUM_RPC_URL`           | Opcional; endpoint do provedor no servidor, nunca chave privada da carteira                      |

O responsável pelo frontend deve salvar no ambiente **Production** e publicar o código atual. `NEXT_PUBLIC_PRIVY_APP_ID` é incorporado no build; mudar apenas a variável sem novo build não atualiza o cliente. Nenhuma seed, private key, senha Rabby ou signer deve ser colocada na Vercel.

No painel Privy, preserve o plano gratuito e Google login habilitado. Como o domínio continua o mesmo, mantenha a origem `https://noria-blue.vercel.app` e o callback `https://noria-blue.vercel.app/auth/callback` autorizados. Se publicar outro domínio, autorize também a nova origem exata e seu callback; a troca de repositório não faz isso automaticamente. Para testar localmente, adicione também a origem de desenvolvimento `http://127.0.0.1:3100` e seu callback correspondente conforme o painel. O assistente Rabby na porta `3210` não utiliza Privy.

O app já tem CSP para os fluxos Privy; veja [setup](../privy/setup.md) e [configuração de segurança](../../next.config.ts). Se mudar provedor ou domínio, confira a [orientação oficial de CSP](https://docs.privy.io/security/implementation-guide/content-security-policy) e o [checklist oficial](https://docs.privy.io/security/implementation-guide/security-checklist). Não libere domínios arbitrários nem desative CSP para esconder um erro.

Depois de configurar a fábrica real e publicar o frontend, abra `https://noria-blue.vercel.app/aqua`, conecte a carteira **Privy do usuário** e confira que a indicação `deployment-required` desapareceu. Uma carteira sem posição pode corretamente ter `position: null`; isso não é erro.

## 12. Testar o fluxo público com Privy

A Rabby do deploy e a Privy do usuário são carteiras diferentes. Ter gas na Rabby não dá gas à Privy. A Privy precisa receber native USDC e ETH na Arbitrum para suas próprias operações.

1. Abra `/reserve`, faça login Google e confirme o endereço da carteira embedded.
2. Use o onramp EUR se o provedor oferecer essa opção à sua conta, ou transfira fundos de outra carteira para o endereço mostrado. Confira **rede Arbitrum One**, ativo e endereço antes de enviar.
3. Complete dados pessoais e pagamento diretamente no provedor. Nenhum agente deve preencher identidade por você. “Janela fechada” ou “pedido submetido” não significa que os tokens chegaram: confira o saldo onchain e o recibo do provedor.
4. Se o formulário não oferecer Brasil como país de nascimento/nacionalidade, não escolha informação falsa. A versão atual do SDK apresenta uma limitação nessa seleção; use o suporte do provedor ou outro funding já disponível. Não habilite produto pago/comercial para contornar isso.
5. Para demonstrar a integração Privy geralmente disponível, execute uma transferência USDC/ETH ou approve + supply + withdraw na Aave pela interface, confirmando cada operação na Privy. Onramp experimental sozinho não substitui essa evidência.
6. Confira o extrato: estado, hash, efeito verificado, gas e saldo observado. Baixe `noria-privy-operations.json`.

**A reserva pessoal da Aave e o colateral da posição Aqua não são a mesma conta.** Se você depositou seu USDC na reserva pessoal, saque o valor necessário de volta para a Privy antes de abrir a posição. O botão de planejar pode preencher o valor, mas não movimenta automaticamente a reserva.

## 13. Lançar e encerrar uma posição Aqua pela UI

Use um valor que você decidiu destinar ao teste e mantenha gas para as etapas de saída. O valor aceito depende da capacidade atual e das regras do planner; uma recusa legítima não deve ser removida para a demo passar.

| Etapa               | O que você vê / confirma                                       | O que realmente acontece                                                                                 |
| ------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Planejar            | Colateral USDC ou ETH, HF de segurança e confortável, pesquisa | Aave dimensiona a dívida; The Graph fornece pool de referência, range e inventário. Não há transferência |
| Criar conta         | `Create position account`                                      | A fábrica registra uma conta pertencente à Privy                                                         |
| Preparar colateral  | Wrap se entrou com ETH; aprovação exata                        | ETH vira WETH se necessário; a conta recebe allowance apenas do valor revisado                           |
| Abrir               | `Supply collateral and borrow USDC`                            | Colateral entra na Aave em nome da conta; USDC emprestado chega à conta. Juros começam aqui              |
| Preparar inventário | Revisão de swap e mínimo recebido                              | Parte do USDC vira WETH pelo adaptador de rota fixa                                                      |
| Lançar              | `Launch Aqua strategy`                                         | Programa SwapVM oficial é publicado via Aqua; tokens ficam na conta maker com saldos virtuais            |
| Parar               | `Stop strategy and repay available USDC`                       | Aqua é desativada para essa estratégia, allowances são removidas e USDC disponível paga dívida           |
| Realizar WETH       | `Sell remaining WETH and repay`, quando necessário             | Vende inventário com mínimo/deadline e amortiza dívida                                                   |
| Quitar diferença    | Aprovar valor exato + repayment externo, se necessário         | Dinheiro adicional do usuário cobre o saldo devedor; não é lucro da LP                                   |
| Sair                | `Return collateral`, somente com dívida zero                   | Colateral e saldos residuais voltam à Privy                                                              |
| Desembrulhar        | Unwrap opcional                                                | WETH da carteira vira ETH                                                                                |

Cada transação tem revisão e confirmação separadas. Se um plano expirar, peça pesquisa atualizada para a conta existente; isso não toma outro empréstimo. Se a pesquisa falhar, os caminhos de parar e amortizar não dependem de uma recomendação nova.

O USDC inicial é depositado como colateral **e a conta toma USDC emprestado para o inventário**, como definido no produto. A pool Uniswap encontrada é referência de pesquisa. A liquidez desta posição é publicada na **Aqua**, não depositada como NFT de LP na Uniswap.

Se o health factor estiver indisponível, a UI não presume que a posição está saudável. Aumentar exposição fica bloqueado; parar, amortizar e sair sem dívida ainda podem ser revisados. A operação precisa passar na simulação, e indisponibilidade real da Aave pode impedir uma transação mesmo nesses caminhos.

## 14. Demo no terminal: fills, ciclos e política 50/50

Para exercitar o lifecycle usado pelo frontend, com planos atuais e as duas opções de colateral:

```sh
npm run validate:aqua-launch
```

Relatórios: `.runtime/aqua-launch-validation.json`, `.runtime/aqua-launch-validation-usdc.json` e `.runtime/aqua-launch-validation-eth.json`. Eles registram revisões, operações e efeitos verificados no fork. Este runner não assina pela Privy.

Para a demo mais completa da track 1inch, incluindo taker, fills SwapVM e ciclos:

```sh
npm run --workspace @noria/aqua fork:rehearse
```

Para utilizar endereços públicos escolhidos por vocês, mantendo tudo local:

```sh
NORIA_OWNER=0xc365B6795443380eb76516dA0Cedd5a00B349d66 \
NORIA_TAKER=0x0000000000000000000000000000000000000b0b \
npm run --workspace @noria/aqua fork:rehearse
```

O segundo endereço acima é um ator local demonstrativo, não uma contraparte comercial. Nenhuma chave é necessária. Os endereços devem ser diferentes. Para o caso de colateral USDC:

```sh
NORIA_FUNDING_ASSET=USDC NORIA_COLLATERAL_UNITS=20000000000 \
npm run --workspace @noria/aqua fork:rehearse
```

Esse valor é **20.000 USDC sintéticos de colateral no fork**, expresso em unidades de 6 decimais. Não é um pedido de transferência real.

Para demonstrar o range escolhido pelo sistema The Graph, baixe um plano novo na `/aqua`. No comando abaixo, substitua o caminho pelo arquivo baixado; no Mac, arrastar o arquivo para o Terminal ajuda a inserir o caminho:

```sh
NORIA_PLAN_FILE="$HOME/Downloads/SEU_PLANO.json" \
npm run --workspace @noria/aqua fork:rehearse
```

O plano precisa estar válido. Sem arquivo, o runner utiliza um range de fixture declarado; não apresente esse modo como descoberta ao vivo. Se o RPC não retiver o bloco ou o mercado/financiamento divergir do envelope, a execução recusa e registra a razão.

Os outputs apresentam etapas numeradas, spinner quando o terminal suporta, tempo decorrido, `PASS/FAIL`, recibos, blocos e taxas. Em logs redirecionados, não há animação nem sequências ANSI. Uma transação que deve reverter é marcada explicitamente como **expected revert confirmed**; não é escondida nem tratada como receita.

Para salvar a apresentação textual:

```sh
npm run --workspace @noria/aqua fork:rehearse \
  > .runtime/demo-stdout.log 2> .runtime/demo-terminal.log
```

O runner informa a pasta exata `integrations/aqua/runs/<run-id>/` com `manifest.json`, `operations.jsonl`, transações/recibos/traces, `report.md` e `report.html`. Copie o caminho mostrado para abrir o HTML no Mac:

```sh
open integrations/aqua/runs/ID_MOSTRADO_NO_TERMINAL/report.html
```

Para os jurados, mostre nesta ordem: configuração oficial e bloco → depósito/empréstimo → preparação de inventário → ship → rejeição de taker sem credencial → fills nas duas direções → juros → dock → confirmação de origem → alocação → novo ciclo sem novo empréstimo → defesa → dívida zero → devolução de colateral.

**O acesso do taker importa.** O fork cria uma credencial de teste por impersonação local do administrador do contrato oficial. Isso comprova que as regras de acesso e as transferências funcionam; não fornece essa credencial na rede pública. A 1inch não passa a rotear automaticamente para a estratégia porque houve deploy/ship. Admissão, distribuição da ordem e acesso do taker público continuam sendo pré-condições externas. Veja [integração](integration.md).

Na política econômica, paga-se o juro, recuperam-se perdas anteriores e só então se reparte excedente elegível. Em situação confortável, metade do excedente reduz dívida e metade permanece no próximo principal. Na faixa de atenção, todo excedente elegível vai para a dívida. O relatório separa colateral remunerado, juros da dívida, conversões, gas, aportes e transferências entre atores relacionados. Não chame pagamento do próprio taker ao próprio maker de receita externa; o resultado consolidado pode ser negativo. A UI pública ainda não automatiza a confirmação de proveniência nem a alocação dos ciclos.

## 15. Erros e retomada

| Situação                                    | O que fazer                                                                                                    |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Rabby não encontrada                        | Abrir `127.0.0.1:3210` em Chrome/Brave com a extensão, desbloquear e atualizar                                 |
| Carteira/rede diferente                     | Selecionar a carteira indicada e Arbitrum One; não substituir o endereço no código para contornar              |
| Saldo insuficiente                          | Adicionar ETH à carteira correta **na Arbitrum**, atualizar e estimar novamente                                |
| Revisão expirou sem assinatura              | `Cancel unsigned review` e preparar novamente                                                                  |
| Rejeitei na Rabby                           | A rejeição explícita cancela a tentativa; não houve recibo de deploy                                           |
| Janela fechou, timeout ou não sei se enviou | Abrir Rabby Activity e Arbiscan; recuperar hash. Não confirmar outro deploy enquanto houver incerteza          |
| Receipt ainda não existe                    | Aguardar e clicar Verify novamente. A consulta não reenvia a transação                                         |
| Recibo revertido                            | Verificar para registrar a falha e gas; investigar antes de uma nova tentativa                                 |
| Outra aba mudou a revisão                   | Atualizar a página e conferir o estado atual; revisões têm identidade própria                                  |
| Terminal fechou                             | Voltar à mesma pasta e executar `npm run deploy:aqua`; ele restaura `.runtime/aqua-deployment/deployment.json` |
| Código/owner mudou após começar             | Preservar relatório e checkout original; não apagar o histórico pendente para liberar outro envio              |
| RPC rate limit / histórico ausente          | Usar endpoint Arbitrum adequado em `ARBITRUM_RPC_URL` na `.env.local`; nunca publicar credenciais              |
| `deployment-required` na Vercel             | Conferir variável Production e novo deploy; preview e produção podem ter variáveis distintas                   |
| Runtime inválido                            | Não relaxar a verificação. Conferir fonte, settings, rede, construtores e artefatos                            |
| Operação Privy pendente                     | Usar a recuperação do extrato dessa carteira/origem. Não limpar localStorage nem repetir uma operação incerta  |

As páginas do app salvam atividade por origem do navegador. Produção e preview Vercel não compartilham esse histórico. Uma confirmação Arbitrum também não equivale automaticamente à liquidação final na Ethereum.

## 16. Checklist de aceite e material para os três avaliadores

- [ ] `typecheck`, testes Node e Solidity e verificação de artefatos passaram no commit usado.
- [ ] Os dois deploys locais foram simulados; relatório identificado como fork.
- [ ] Adaptador e fábrica públicos têm recibos, runtime conferido e fonte publicado no explorer.
- [ ] A Vercel aceita a fábrica e o fluxo não utiliza fixtures como fallback.
- [ ] Privy cria/abre a carteira e uma ação financeira real tem recibo e efeito verificado.
- [ ] USDC/ETH, dívida, colateral, health factor e taxas estão claros na interface e no extrato.
- [ ] The Graph fornece pesquisa/recusa com fonte e timestamps; plano é rastreável ao programa Aqua.
- [ ] A demo 1inch mostra transferências no fork oficial, inclusive taker credenciado, sem alegar routing orgânico.
- [ ] A posição de teste público foi parada e encerrada, ou sua dívida/saldo pendentes foram explicitamente documentados.
- [ ] Relatórios distinguem fatos públicos, fixtures locais, estados não verificados e resultado econômico.

Leia também a [revisão dos contratos e limites conhecidos](contract-review.md). Os testes não são garantia de lucro, disponibilidade de oráculo, ausência de liquidação ou auditoria externa. Em especial, o contrato utiliza os preços/controles Aave; não implementa uma verificação própria do timestamp de cada feed e do período de recuperação do sequencer Arbitrum. Esse limite continua visível na revisão.

Mapa de código para avaliação: [contratos](../../integrations/aqua/contracts/src), [preflight e assinatura Rabby](../../scripts/deploy-aqua.ts), [UI local](../../scripts/deploy/app.js), [launch API](../../src/integrations/aqua/launch-service.ts), [wallet Privy](../../src/components/NoriaWalletProvider.tsx), [pesquisa](../../src/integrations/aqua/service.ts), [rehearsal](../../integrations/aqua/scripts/rehearse.ts). Os links desta última seção são relativos à raiz; o [README principal](../../README.md) reúne o mapa das três tracks.
