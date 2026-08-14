import { cache } from "react";

/**
 * O instante em que esta requisição está sendo renderizada.
 *
 * `cache` do React memoiza por render: a lista, o cabeçalho e qualquer
 * outro componente da mesma página leem o MESMO "agora". Sem isso, duas
 * contagens de hold na mesma tela poderiam divergir em um segundo só
 * porque foram renderizadas em momentos diferentes — e o operador
 * enxergaria dois prazos para a mesma venda.
 *
 * Ler o relógio direto no corpo de um componente também é impureza de
 * render (`react-hooks/purity`); aqui a leitura fica atrás de uma função
 * estável por requisição, que é o que o React espera.
 */
export const agoraDoRender = cache((): number => Date.now());
