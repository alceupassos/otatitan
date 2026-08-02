-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_tenantId_propertyId_fkey" FOREIGN KEY ("tenantId", "propertyId") REFERENCES "Property"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
