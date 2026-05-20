using System.Collections;
using System.Collections.Generic;
using UnityEngine;

[ExecuteInEditMode]
public class DrawLegPolygon : MonoBehaviour
{

    //public Material mat;

    // Start is called before the first frame update
    void Start()
    {

        var mesh = new Mesh();

        Vector3[] vertices = new Vector3[5];

        vertices[0] = (new Vector3(1,0,1));
        vertices[1] = (new Vector3(0,0,2.5f));
        vertices[2] = (new Vector3(-1,0,1));
        vertices[3] = (new Vector3(-1,0,-1));
        vertices[4] = (new Vector3(1, 0, -1));

        List<int> triangles = new List<int>();
        triangles.AddRange(new int[] { 2, 1, 0 });
        triangles.AddRange(new int[] { 3, 2, 4 });
        triangles.AddRange(new int[] { 2, 0, 4 });


        //List<Vector3> normals = new List<Vector3>();
        //for (int i =0; i<vertices.Length; i++)
        //{
        //    normals.Add(Vector3.up);
        //}

        mesh.vertices = vertices;
        mesh.triangles = triangles.ToArray();
        //mesh.SetNormals(normals);

        GetComponent<MeshFilter>().mesh = mesh;
        //GetComponent<MeshRenderer>().material = mat;


    }

    // Update is called once per frame
    void Update()
    {
        
    }
}
