using System.IO;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using Unity.IO;

//TODO:
// It can be much nicer if the saved data will be saved as coordinates, and not in scene units.

[System.Serializable]
public class Position
{
    public float x;
    public float y;
    public float z;

    public Position(float[] vector)
    {
        this.x = vector[0];
        this.y = vector[1];
        this.z = vector[2];
    }
}

[System.Serializable]
public class SceneData
{
    
    public List<Position> waypoints;

    public SceneData(List<GameObject> waypoints)
    {
        
        this.waypoints = new List<Position>();

        foreach (GameObject wp in waypoints)
        {
            float[] vector = new float[3];
            vector[0] = wp.transform.position.x;
            vector[1] = wp.transform.position.y;
            vector[2] = wp.transform.position.z;
            this.waypoints.Add(new Position(vector));
        }
    }
}


public class Data
{
    private string GetFullPath(string filename)
    {
        return Application.persistentDataPath + "/" + filename;
    }
    
    public void Save(SceneData data, string filename)
    {
        string fullpath = GetFullPath(filename);
        Debug.Log("Saving to - " + fullpath);
        string json = JsonUtility.ToJson(data);
        Debug.Log(json);
        FileStream stream = new FileStream(filename, FileMode.Create);

        using (StreamWriter writer = new StreamWriter(fullpath))
        {
            writer.Write(json);
        }

    }

    public SceneData Load(string filename)
    {
        string fullpath = GetFullPath(filename);
        if (File.Exists(fullpath))
        {
            using (StreamReader reader = new StreamReader(fullpath))
            {
                string json = reader.ReadToEnd();
                SceneData data = JsonUtility.FromJson<SceneData>(json);
                return data;
            }
        }
        else
        {
            Debug.LogError("File not found! - " + fullpath);
            return new SceneData(new List<GameObject>());
        }
    }

}
