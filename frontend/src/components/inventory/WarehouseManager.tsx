import React, { useState } from "react";
import { Plus, ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { ProductDisplay } from "@/components/ui/ProductDisplay";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { api, type ProductSKUOut, type RawIngredientOut, type WarehouseOut, type WarehouseStockOut } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { formatProductQuantity, isCurrentLineupProduct } from "@/lib/utils";

interface WarehouseManagerProps {
  warehouses: WarehouseOut[];
  warehouseStocks: WarehouseStockOut[];
  ingredients: RawIngredientOut[];
  products: ProductSKUOut[];
  onRefresh: () => void;
}

export default function WarehouseManager({
  warehouses,
  warehouseStocks,
  ingredients,
  products,
  onRefresh
}: WarehouseManagerProps) {
  // Register Warehouse states
  const [newWhName, setNewWhName] = useState("");
  const [newWhLocation, setNewWhLocation] = useState("");
  const [registering, setRegistering] = useState(false);

  // Transfer states
  const [transferSource, setTransferSource] = useState("");
  const [transferDest, setTransferDest] = useState("");
  const [transferType, setTransferType] = useState<"raw" | "sku">("raw");
  const [transferRawId, setTransferRawId] = useState("");
  const [transferSku, setTransferSku] = useState("");
  const [transferQty, setTransferQty] = useState("");
  const [transferring, setTransferring] = useState(false);
  const currentProducts = products.filter(isCurrentLineupProduct);
  const productBySku = new Map(currentProducts.map((product) => [product.sku, product]));
  const ingredientById = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));

  const handleRegisterWarehouse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWhName.trim()) {
      alert("Please enter a warehouse name.");
      return;
    }

    setRegistering(true);
    try {
      await api.createWarehouse({
        name: newWhName.trim(),
        location: newWhLocation.trim() || null,
        is_active: true
      });
      setNewWhName("");
      setNewWhLocation("");
      onRefresh();
      alert("Warehouse registered successfully!");
    } catch (err: unknown) {
      alert(`Error: ${getErrorMessage(err)}`);
    } finally {
      setRegistering(false);
    }
  };

  const handleTransferStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferSource || !transferDest) {
      alert("Please select source and destination warehouses.");
      return;
    }
    if (transferSource === transferDest) {
      alert("Source and destination warehouses must be different.");
      return;
    }
    if (transferType === "raw" && !transferRawId) {
      alert("Please select a raw material to transfer.");
      return;
    }
    if (transferType === "sku" && !transferSku) {
      alert("Please select a product SKU to transfer.");
      return;
    }
    const qty = parseFloat(transferQty);
    if (isNaN(qty) || qty <= 0) {
      alert("Please enter a valid transfer quantity.");
      return;
    }

    setTransferring(true);
    try {
      await api.transferWarehouseInventory({
        source_warehouse_id: parseInt(transferSource),
        destination_warehouse_id: parseInt(transferDest),
        raw_ingredient_id: transferType === "raw" ? parseInt(transferRawId) : null,
        sku: transferType === "sku" ? transferSku : null,
        quantity: qty
      });
      setTransferQty("");
      setTransferRawId("");
      setTransferSku("");
      onRefresh();
      alert("Stock transferred successfully!");
    } catch (err: unknown) {
      alert(`Error transferring stock: ${getErrorMessage(err)}`);
    } finally {
      setTransferring(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
      {/* Directory listing */}
      <div className="lg:col-span-2 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Warehouse Directory</CardTitle>
            <CardDescription>Multi-location stock distributions</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4" role="list" aria-label="Warehouse locations">
            {warehouses.map((wh) => {
              const whStocks = warehouseStocks.filter(
                (stock) =>
                  stock.warehouse_id === wh.id &&
                  stock.quantity > 0 &&
                  (!stock.sku || productBySku.has(stock.sku))
              );
              
              return (
                <div key={wh.id} role="listitem" className="border border-slate-200 rounded-xl p-4 bg-slate-50 shadow-3xs hover:border-slate-350 hover:scale-[1.01] transition-transform duration-150">
                  <div className="flex justify-between items-start mb-3 border-b border-slate-200/50 pb-2">
                    <div>
                      <span className="font-heading font-extrabold text-slate-900 text-xs uppercase tracking-wide">{wh.name}</span>
                      <span className="text-[10px] text-slate-450 font-bold block mt-0.5">{wh.location || "No Address Logged"}</span>
                    </div>
                    <StatusBadge status={wh.is_active ? "active" : "inactive"} />
                  </div>
                  
                  {whStocks.length === 0 ? (
                    <p className="text-[10px] text-slate-400 italic">No inventory currently stocked in this warehouse.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-semibold text-slate-700" role="list" aria-label={`${wh.name} stock`}>
                      {whStocks.map((stock) => {
                        const product = stock.sku ? productBySku.get(stock.sku) : undefined;
                        const ingredient = stock.raw_ingredient_id ? ingredientById.get(stock.raw_ingredient_id) : undefined;
                        const quantityLabel = product
                          ? formatProductQuantity(product, stock.quantity)
                          : `${stock.quantity} ${ingredient?.unit || "units"}`;

                        return (
                          <div key={`${wh.id}-${stock.sku || stock.raw_ingredient_id}`} role="listitem" className="flex min-w-0 justify-between items-center gap-3 bg-white border border-slate-200 px-3 py-2 rounded-xl hover:scale-[1.01] transition-transform duration-150">
                            {product && stock.sku ? (
                              <ProductDisplay
                                sku={stock.sku}
                                productName={stock.product_name || product.product_name || stock.sku}
                                category={product.category}
                                size={product.size}
                                isActive={product.is_active}
                                variant="compact"
                              />
                            ) : (
                              <span className="min-w-0 truncate font-bold">{stock.ingredient_name || ingredient?.name || `Ingredient #${stock.raw_ingredient_id}`}</span>
                            )}
                            <span className="shrink-0 rounded-lg bg-slate-100 px-2 py-1 font-mono text-[10px] font-bold text-slate-900">
                              {quantityLabel}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Register Warehouse */}
        <Card>
          <CardHeader>
            <CardTitle>Register New Warehouse</CardTitle>
            <CardDescription>Configure secondary retail outlets or staging warehouses</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleRegisterWarehouse} className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
              <div className="sm:col-span-1">
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1.5">Warehouse Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. AA Mart Staging"
                  value={newWhName}
                  onChange={(e) => setNewWhName(e.target.value)}
                  className="w-full text-xs font-semibold"
                />
              </div>
              <div className="sm:col-span-1">
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1.5">Location / Address</label>
                <input
                  type="text"
                  placeholder="e.g. Ground Floor, AA Bldg"
                  value={newWhLocation}
                  onChange={(e) => setNewWhLocation(e.target.value)}
                  className="w-full text-xs font-semibold"
                />
              </div>
              <Button
                type="submit"
                variant="primary"
                className="w-full"
                isLoading={registering}
                leftIcon={<Plus size={14} />}
              >
                Register
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Transfer Stock form */}
      <Card>
        <CardHeader>
          <CardTitle>Transfer Stock Inventory</CardTitle>
          <CardDescription>Dispatch materials between warehouses</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleTransferStock} className="space-y-4">
            <div>
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1.5">Source Location</label>
              <select
                value={transferSource}
                onChange={(e) => setTransferSource(e.target.value)}
                required
                className="w-full text-xs font-semibold"
              >
                <option value="">Select Source Warehouse...</option>
                {warehouses.map(w => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1.5">Destination Location</label>
              <select
                value={transferDest}
                onChange={(e) => setTransferDest(e.target.value)}
                required
                className="w-full text-xs font-semibold"
              >
                <option value="">Select Destination...</option>
                {warehouses
                  .filter(w => w.id.toString() !== transferSource)
                  .map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1.5">Material Category</label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <Button
                  type="button"
                  variant={transferType === "raw" ? "primary" : "outline"}
                  size="sm"
                  onClick={() => { setTransferType("raw"); setTransferSku(""); }}
                >
                  Raw Ingredient
                </Button>
                <Button
                  type="button"
                  variant={transferType === "sku" ? "primary" : "outline"}
                  size="sm"
                  onClick={() => { setTransferType("sku"); setTransferRawId(""); }}
                >
                  Finished SKU
                </Button>
              </div>
            </div>

            {transferType === "raw" ? (
              <div>
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1.5">Raw Material</label>
                <select
                  value={transferRawId}
                  onChange={(e) => setTransferRawId(e.target.value)}
                  required
                  className="w-full text-xs font-semibold"
                >
                  <option value="">Choose Raw Ingredient...</option>
                  {ingredients.map(ing => (
                    <option key={ing.id} value={ing.id}>{ing.name} ({ing.unit})</option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1.5">Finished SKU</label>
                <select
                  value={transferSku}
                  onChange={(e) => setTransferSku(e.target.value)}
                  required
                  className="w-full text-xs font-semibold"
                >
                  <option value="">Choose Finished SKU...</option>
                  {currentProducts.filter((product) => product.is_active !== false).map(p => (
                    <option key={p.sku} value={p.sku}>{p.product_name} — {p.sku}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1.5">Transfer Quantity</label>
              <input
                type="number"
                min={0.01}
                step={0.01}
                required
                placeholder="e.g. 150"
                value={transferQty}
                onChange={(e) => setTransferQty(e.target.value)}
                className="w-full font-mono text-xs font-semibold"
              />
            </div>

            <Button
              type="submit"
              variant="primary"
              className="w-full mt-2"
              isLoading={transferring}
              leftIcon={<ArrowRightLeft size={14} />}
            >
              Transfer Stock
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
