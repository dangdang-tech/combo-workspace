import { Redirect } from 'expo-router';

/** Metro retains obsolete route keys without loading their removed feature trees. */
export default function RemovedFeatureRoute() {
    return <Redirect href="/" />;
}
