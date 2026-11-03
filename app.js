/**
 * =========================================================================
 *  CONFIGURAÇÃO E LÓGICA DO FIREBASE & AUTENTICAÇÃO MICROSOFT (AZURE)
 * =========================================================================
 *  Projeto: Portal Escolar - Requisição de Hardware (EPBJC / TGPSI)
 */

// Importar os módulos do Firebase CDN (Modular SDK)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
    getAuth, 
    OAuthProvider, 
    signInWithPopup, 
    signOut, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
    getFirestore, 
    collection, 
    getDocs, 
    getDoc, 
    doc, 
    setDoc, 
    updateDoc, 
    deleteDoc, 
    query, 
    where, 
    orderBy 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

/**
 * ATENÇÃO: Substitui estes dados pelos valores reais do teu projeto Firebase
 * (Disponíveis em: Definições do Projeto > As tuas aplicações > Web App)
 */

const firebaseConfig = {
    apiKey: "AIzaSyAYxT7-zYcy3WU5ufvDkOiK6SC2w_WQUGQ",
    authDomain: "epbjc-requisi.firebaseapp.com",
    projectId: "epbjc-requisi",
    storageBucket: "epbjc-requisi.firebasestorage.app",
    messagingSenderId: "667979002412",
    appId: "1:667979002412:web:035bbcd766d8af8bc2d789",
    measurementId: "G-VPW4XKXL9N"
  };

  // Inicializar o Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Configuração correta do Provedor Microsoft
const microsoftProvider = new OAuthProvider('microsoft.com');
microsoftProvider.setCustomParameters({
    tenant: "4334e4b0-48f4-4a76-ae54-cec847437a72" // Apenas o ID limpo, sem "comm" ou "on"
});

/**
 * =========================================================================
 *  CAMADA DE SERVIÇO DE BASE DE DADOS (FIRESTORE) & SEGURANÇA (WHITELIST)
 * =========================================================================
 */
const DatabaseService = {
    
    // Verificar se o utilizador está na coleção 'authorizedUsers' (Lista Branca de 18 alunos/docentes)
    async verificarAutorizacao(email) {
        if (!email) return false;
        try {
            const emailNormalizado = email.toLowerCase().trim();
            const userRef = doc(db, "authorizedUsers", emailNormalizado);
            const userSnap = await getDoc(userRef);
            
            if (userSnap.exists()) {
                const dados = userSnap.data();
                // Retorna verdadeiro se o documento existir e 'active' for true
                return dados.active === true;
            }
            return false;
        } catch (error) {
            console.error("Erro ao verificar lista de autorização:", error);
            return false;
        }
    },

    // Obter requisições (filtradas por UID do utilizador autenticado por razões de segurança)
    async obterRequisicoes(userUid) {
        try {
            const q = query(
                collection(db, "requisicoes"), 
                where("uid", "==", userUid)
            );
            const querySnapshot = await getDocs(q);
            let lista = [];
            querySnapshot.forEach((docSnap) => {
                lista.push({ idDoc: docSnap.id, ...docSnap.data() });
            });
            // Ordenar por data localmente se necessário
            return lista;
        } catch (error) {
            console.error("Erro ao obter requisições do Firestore:", error);
            return [];
        }
    },

    // Criar nova requisição associada ao UID do utilizador
    async criarRequisicao(novaReq) {
        try {
            const novaRef = doc(collection(db, "requisicoes"));
            await setDoc(novaRef, {
                ...novaReq,
                criadoEm: new Date().toISOString()
            });
            return { idDoc: novaRef.id, ...novaReq };
        } catch (error) {
            console.error("Erro ao criar requisição:", error);
            throw error;
        }
    },

    // Atualizar estado de uma requisição
    async atualizarEstado(idDoc, novoEstado) {
        try {
            const reqRef = doc(db, "requisicoes", idDoc);
            await updateDoc(reqRef, { estado: novoEstado });
        } catch (error) {
            console.error("Erro ao atualizar estado:", error);
        }
    },

    // Eliminar requisição
    async eliminarRequisicao(idDoc) {
        try {
            await deleteDoc(doc(db, "requisicoes", idDoc));
        } catch (error) {
            console.error("Erro ao eliminar requisição:", error);
        }
    }
};

// Configurações globais da interface
const dataNecessariaEl = document.getElementById('dataNecessaria');
if (dataNecessariaEl) {
    dataNecessariaEl.min = new Date().toISOString().split("T")[0];
}

let utilizadorAtual = null;
let requisicoes = [];

const loginScreen = document.getElementById('loginScreen');
const appContainer = document.getElementById('appContainer');
const form = document.getElementById('formRequisicao');
const listaRequisicoesEl = document.getElementById('listaRequisicoes');
const emptyStateEl = document.getElementById('emptyState');

/**
 * =========================================================================
 *  GERINDO O ESTADO DA AUTENTICAÇÃO COM FIREBASE AUTH
 * =========================================================================
 */
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // Verificar whitelist no Firestore antes de permitir o acesso total
        const emailUser = user.email || user.providerData[0]?.email;
        const autorizado = await DatabaseService.verificarAutorizacao(emailUser);

        if (!autorizado) {
            alert("Acesso negado: O seu email institucional não se encontra autorizado na lista branca (authorizedUsers).");
            await signOut(auth);
            mostrarLogin();
            return;
        }

        // Calcular iniciais para o avatar
        const nomeCompleto = user.displayName || emailUser.split('@')[0];
        const partes = nomeCompleto.trim().split(" ");
        let iniciais = partes[0][0];
        if (partes.length > 1) {
            iniciais += partes[partes.length - 1][0];
        }

        utilizadorAtual = {
            uid: user.uid,
            nome: nomeCompleto,
            email: emailUser,
            iniciais: iniciais.toUpperCase()
        };

        await inicializarApp();
    } else {
        utilizadorAtual = null;
        mostrarLogin();
    }
});

/**
 * Função global chamada pelo botão HTML para iniciar o login com Microsoft Popup
 */
window.fazerLoginMicrosoft = async function() {
    const btn = document.getElementById('btnLoginMS');
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> A autenticar na Microsoft...`;
    btn.disabled = true;

    try {
        const result = await signInWithPopup(auth, microsoftProvider);
        // O observador onAuthStateChanged tratará do resto automaticamente
    } catch (error) {
        console.error("Erro na autenticação Microsoft:", error);
        alert("Erro ao iniciar sessão com a Microsoft: " + error.message);
        mostrarLogin();
    }
};

/**
 * Terminar Sessão
 */
window.fazerLogout = async function() {
    try {
        await signOut(auth);
    } catch (error) {
        console.error("Erro ao terminar sessão:", error);
    }
};

function mostrarLogin() {
    if (loginScreen) loginScreen.classList.remove('hidden');
    if (appContainer) appContainer.classList.add('hidden');
    const btn = document.getElementById('btnLoginMS');
    if (btn) {
        btn.innerHTML = `
            <svg class="w-5 h-5" viewBox="0 0 23 23">
                <path fill="#f35325" d="M1 1h10v10H1z"/>
                <path fill="#81bc06" d="M12 1h10v10H1z"/>
                <path fill="#05a6f0" d="M1 12h10v10H1z"/>
                <path fill="#ffba08" d="M12 12h10v10H1z"/>
            </svg>
            <span>Entrar com conta Microsoft</span>
        `;
        btn.disabled = false;
    }
}

async function inicializarApp() {
    if (loginScreen) loginScreen.classList.add('hidden');
    if (appContainer) appContainer.classList.remove('hidden');

    // Atualizar interface do perfil
    document.getElementById('userName').innerText = utilizadorAtual.nome;
    document.getElementById('userEmail').innerText = utilizadorAtual.email;
    document.getElementById('userAvatar').innerText = utilizadorAtual.iniciais;
    document.getElementById('nome').value = utilizadorAtual.nome;

    // Carregar requisições do Firestore pertencentes ao UID atual
    requisicoes = await DatabaseService.obterRequisicoes(utilizadorAtual.uid);
    renderizarRequisicoes();
    atualizarEstatisticas();
}

/**
 * Submissão de Nova Requisição para o Firestore
 */
if (form) {
    form.addEventListener('submit', async function(e) {
        e.preventDefault();

        const btnSubmeter = document.getElementById('btnSubmeter');
        btnSubmeter.disabled = true;
        btnSubmeter.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> A guardar...`;

        const novaRequisicao = {
            uid: utilizadorAtual.uid,
            nome: utilizadorAtual.nome,
            email: utilizadorAtual.email,
            departamento: document.getElementById('departamento').value,
            hardware: document.getElementById('hardware').value,
            urgencia: document.getElementById('urgencia').value,
            dataNecessaria: document.getElementById('dataNecessaria').value,
            justificacao: document.getElementById('justificacao').value,
            estado: 'Pendente',
            dataRegisto: new Date().toLocaleDateString('pt-PT')
        };

        try {
            await DatabaseService.criarRequisicao(novaRequisicao);
            requisicoes = await DatabaseService.obterRequisicoes(utilizadorAtual.uid);

            renderizarRequisicoes();
            atualizarEstatisticas();

            form.reset();
            document.getElementById('nome').value = utilizadorAtual.nome;
            if (document.getElementById('dataNecessaria')) {
                document.getElementById('dataNecessaria').min = new Date().toISOString().split("T")[0];
            }
        } catch (error) {
            alert("Erro ao submeter requisição.");
        } finally {
            btnSubmeter.disabled = false;
            btnSubmeter.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Submeter Requisição`;
        }
    });
}

// Funções globais ligadas à tabela
window.alterarEstado = async function(idDoc, novoEstado) {
    await DatabaseService.atualizarEstado(idDoc, novoEstado);
    requisicoes = await DatabaseService.obterRequisicoes(utilizadorAtual.uid);
    renderizarRequisicoes();
    atualizarEstatisticas();
};

window.apagarRequisicao = async function(idDoc) {
    if (confirm('Tem a certeza que pretende eliminar esta requisição?')) {
        await DatabaseService.eliminarRequisicao(idDoc);
        requisicoes = await DatabaseService.obterRequisicoes(utilizadorAtual.uid);
        renderizarRequisicoes();
        atualizarEstatisticas();
    }
};

window.renderizarRequisicoes = function() {
    const filtroEl = document.getElementById('filtroEstado');
    const filtro = filtroEl ? filtroEl.value : 'TODOS';
    if (!listaRequisicoesEl) return;
    
    listaRequisicoesEl.innerHTML = '';

    const requisicoesFiltradas = requisicoes.filter(req => {
        if (filtro === 'TODOS') return true;
        return req.estado === filtro;
    });

    if (requisicoesFiltradas.length === 0) {
        if (emptyStateEl) emptyStateEl.classList.remove('hidden');
        return;
    } else {
        if (emptyStateEl) emptyStateEl.classList.add('hidden');
    }

    requisicoesFiltradas.forEach(req => {
        let badgeStyle = 'bg-amber-50 text-amber-700 border-amber-200/80';
        if (req.estado === 'Aprovado') badgeStyle = 'bg-blue-50 text-blue-700 border-blue-200/80';
        else if (req.estado === 'Entregue') badgeStyle = 'bg-emerald-50 text-emerald-700 border-emerald-200/80';
        else if (req.estado === 'Rejeitado') badgeStyle = 'bg-rose-50 text-rose-700 border-rose-200/80';

        let urgenciaBadge = '';
        if (req.urgencia === 'Urgente') urgenciaBadge = '<span class="text-[11px] text-amber-600 font-semibold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">Urgente</span>';
        if (req.urgencia === 'Crítica') urgenciaBadge = '<span class="text-[11px] text-rose-600 font-semibold bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200">Crítica</span>';

        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50/80 transition duration-150';
        tr.innerHTML = `
            <td class="py-3.5 px-3">
                <div class="font-semibold text-slate-800">${req.nome}</div>
                <div class="text-xs text-slate-400">${req.departamento}</div>
            </td>
            <td class="py-3.5 px-3">
                <div class="font-medium text-slate-700">${req.hardware}</div>
                <div class="text-xs text-slate-400 truncate max-w-xs" title="${req.justificacao}">"${req.justificacao}"</div>
            </td>
            <td class="py-3.5 px-3">
                <div class="text-xs font-medium text-slate-700 flex items-center gap-1.5">${req.dataNecessaria} ${urgenciaBadge}</div>
                <div class="text-[11px] text-slate-400 mt-0.5">Pedido a ${req.dataRegisto}</div>
            </td>
            <td class="py-3.5 px-3">
                <span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${badgeStyle}">
                    ${req.estado}
                </span>
            </td>
            <td class="py-3.5 px-3 text-right">
                <div class="flex items-center justify-end gap-2">
                    <select onchange="alterarEstado('${req.idDoc}', this.value)" class="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium">
                        <option value="" disabled selected>Alterar...</option>
                        <option value="Pendente">Pendente</option>
                        <option value="Aprovado">Aprovado</option>
                        <option value="Entregue">Entregue</option>
                        <option value="Rejeitado">Rejeitado</option>
                    </select>
                    <button onclick="apagarRequisicao('${req.idDoc}')" title="Eliminar" class="text-slate-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50 transition duration-150">
                        <i class="fa-solid fa-trash-can text-xs"></i>
                    </button>
                </div>
            </td>
        `;
        listaRequisicoesEl.appendChild(tr);
    });
};

function atualizarEstatisticas() {
    const total = requisicoes.length;
    const pendentes = requisicoes.filter(r => r.estado === 'Pendente').length;
    const aprovados = requisicoes.filter(r => r.estado === 'Aprovado' || r.estado === 'Entregue').length;
    const urgentes = requisicoes.filter(r => r.urgencia === 'Urgente' || r.urgencia === 'Crítica').length;

    if (document.getElementById('statTotal')) document.getElementById('statTotal').innerText = total;
    if (document.getElementById('statPendentes')) document.getElementById('statPendentes').innerText = pendentes;
    if (document.getElementById('statAprovados')) document.getElementById('statAprovados').innerText = aprovados;
    if (document.getElementById('statUrgentes')) document.getElementById('statUrgentes').innerText = urgentes;
}
