// Isolated browser simulation. Never import the API client or persist these records.
export const products = [
  {
    id: "pesto",
    name: "Basil pesto",
    category: "Spreads & Sauces",
    unit: "180 g jar",
    price: 240,
    cost: 96,
  },
  {
    id: "tomato",
    name: "Roasted tomato sauce",
    category: "Spreads & Sauces",
    unit: "250 g jar",
    price: 190,
    cost: 76,
  },
  {
    id: "sandwich",
    name: "Garden sandwich",
    category: "Sandwiches & Salads",
    unit: "single serving",
    price: 180,
    cost: 72,
  },
] as const;
export type ProductId = (typeof products)[number]["id"];
export type DemoOrder = {
  id: number;
  customer: string;
  product: ProductId;
  quantity: number;
  price: number;
  cost: number;
  status: "Queued" | "Fulfilled" | "Cancelled";
};
export type DemoState = {
  stock: Record<ProductId, number>;
  orders: DemoOrder[];
  activity: string[];
  nextId: number;
};
export type DemoAction =
  | { type: "reset" }
  | { type: "receive"; product: ProductId; quantity: number }
  | { type: "order"; product: ProductId; quantity: number; customer: string }
  | { type: "fulfil" | "cancel"; id: number };
export function initialDemo(): DemoState {
  return {
    stock: { pesto: 18, tomato: 8, sandwich: 12 },
    orders: [
      {
        id: 1001,
        customer: "Sample café A",
        product: "pesto",
        quantity: 4,
        price: 240,
        cost: 96,
        status: "Queued",
      },
      {
        id: 1002,
        customer: "Sample market B",
        product: "tomato",
        quantity: 10,
        price: 190,
        cost: 76,
        status: "Queued",
      },
    ],
    activity: ["Sample workspace opened. No live accounts or transactions."],
    nextId: 1003,
  };
}
export function transition(state: DemoState, action: DemoAction): DemoState {
  if (action.type === "reset") return initialDemo();
  const log = (message: string) => [message, ...state.activity].slice(0, 12);
  if (action.type === "receive" || action.type === "order") {
    const product = products.find((p) => p.id === action.product);
    if (
      !product ||
      !Number.isInteger(action.quantity) ||
      action.quantity < 1 ||
      action.quantity > 1000
    )
      throw new Error("Enter a whole quantity between 1 and 1,000.");
    if (action.type === "receive")
      return {
        ...state,
        stock: {
          ...state.stock,
          [product.id]: state.stock[product.id] + action.quantity,
        },
        activity: log(
          `Received ${action.quantity} × ${product.name} into sample stock.`,
        ),
      };
    if (
      !["Sample café A", "Sample market B", "Sample shop C"].includes(
        action.customer,
      )
    )
      throw new Error("Choose a sample customer.");
    return {
      ...state,
      nextId: state.nextId + 1,
      orders: [
        ...state.orders,
        {
          id: state.nextId,
          customer: action.customer,
          product: product.id,
          quantity: action.quantity,
          price: product.price,
          cost: product.cost,
          status: "Queued",
        },
      ],
      activity: log(
        `Order #${state.nextId} queued. Stock changes only on fulfilment.`,
      ),
    };
  }
  const order = state.orders.find((o) => o.id === action.id);
  if (!order || order.status !== "Queued")
    throw new Error("This order is no longer queued.");
  if (action.type === "fulfil" && state.stock[order.product] < order.quantity)
    throw new Error(
      "Not enough stock. Receive stock in Inventory before fulfilling this order.",
    );
  return {
    ...state,
    stock:
      action.type === "fulfil"
        ? {
            ...state.stock,
            [order.product]: state.stock[order.product] - order.quantity,
          }
        : state.stock,
    orders: state.orders.map((o) =>
      o.id === order.id
        ? { ...o, status: action.type === "fulfil" ? "Fulfilled" : "Cancelled" }
        : o,
    ),
    activity: log(
      `Order #${order.id} ${action.type === "fulfil" ? "fulfilled; sample stock deducted" : "cancelled; stock unchanged"}.`,
    ),
  };
}
export function estimateCost(
  unitCost: number,
  price: number,
  quantity: number,
) {
  if (
    ![unitCost, price, quantity].every(Number.isFinite) ||
    unitCost < 0 ||
    price <= 0 ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > 1000
  )
    return null;
  return {
    cost: unitCost * quantity,
    revenue: price * quantity,
    profit: (price - unitCost) * quantity,
    margin: ((price - unitCost) / price) * 100,
  };
}
