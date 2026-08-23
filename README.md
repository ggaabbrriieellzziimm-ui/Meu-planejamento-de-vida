# Meu Planejamento de Vida

PWA (Progressive Web App) com dois apps em um só lugar:

- **Rotina & Ordens de Serviço** (`rotina.html`) — semana modelo, aba "Hoje", metas, caixa de entrada e ordens de serviço.
- **Livro-Caixa** (`financas.html`) — controle financeiro pessoal.

A tela inicial (`index.html`) é o menu para escolher qual dos dois abrir. Os dados de cada app salvam automaticamente no navegador (localStorage) — não precisa de servidor nem banco de dados.

## Como colocar no ar com GitHub Pages

1. Crie um repositório novo no GitHub (pode ser público ou privado).
2. Envie todos os arquivos desta pasta para a raiz do repositório (mantendo a pasta `assets/` junto):
   ```
   git init
   git add .
   git commit -m "Meu Planejamento de Vida"
   git branch -M main
   git remote add origin https://github.com/SEU-USUARIO/SEU-REPOSITORIO.git
   git push -u origin main
   ```
3. No GitHub, vá em **Settings → Pages**.
4. Em "Build and deployment", selecione **Deploy from a branch**, branch **main**, pasta **/ (root)**. Salve.
5. Em alguns minutos o GitHub mostra o link, algo como:
   `https://SEU-USUARIO.github.io/SEU-REPOSITORIO/`
6. Abra esse link no celular. No Android (Chrome), toque no menu **⋮ → Instalar aplicativo** (ou "Adicionar à tela inicial") para instalar como app, com o ícone azul da citação "Quando pensar em desistir".

## Estrutura de arquivos

```
index.html          → menu principal (tela inicial)
rotina.html          → app de rotina/ordens de serviço
financas.html        → app de finanças (Livro-Caixa)
manifest.json         → configuração do PWA (nome, ícones, cores)
service-worker.js     → cache para uso offline
assets/
  background-light.jpg → imagem de fundo do menu ("Pequenos passos também levam longe")
  icon-192.png          → ícone do app (192×192)
  icon-512.png          → ícone do app (512×512)
  icon-180.png          → ícone para iPhone/iOS
  icon-32.png           → favicon
```

## Backup dos dados

Cada app tem seu próprio botão de backup/restauração (arquivo `.json`), útil para trocar de celular ou navegador, ou como segurança extra além do salvamento automático.

## Atualizando depois de subir

Sempre que quiser mudar algo, edite os arquivos e rode:
```
git add .
git commit -m "Descrição da mudança"
git push
```
O GitHub Pages atualiza sozinho em 1–2 minutos.
